import { Container, Graphics, NineSliceSprite, Texture } from "pixi.js";
import { gsap } from "gsap";
import { List } from "@pixi/ui"; // Keeping just in case other things use it quietly, actually better to remove. Wait, I will remove it.
import { CardHistoryItem } from "../../../ui/CardHistoryItem";
import { GuessAction } from "../types/GameTypes";

/**
 * Manages the display of past card results using a horizontal scroll layout.
 * Uses `@pixi/ui` List for stable layout management and robust animation handling
 * to prevent race conditions during rapid updates ("speed runs").
 */
export type CardHistoryDirection = 'ltr' | 'rtl' | 'ttb' | 'btt';

export interface CardHistoryLayoutOptions {
  type?: 'horizontal' | 'vertical'; // default horizontal
  direction?: CardHistoryDirection; // default depends on type. Horizontal: ltr. Vertical: ttb/btt
}

class GapContainer extends Container {
  private _contentWidth: number = 0;
  private _contentHeight: number = 0;

  constructor(
    public leftPad: number,
    public rightPad: number,
    public type: 'horizontal' | 'vertical'
  ) {
    super();
  }

  public addItem(item: Container, fixedWidth?: number, fixedHeight?: number) {
    this.addChild(item);

    // Store fixed dimensions if provided, otherwise fallback (which might be unstable during anim)
    this._contentWidth = fixedWidth ?? item.width;
    this._contentHeight = fixedHeight ?? item.height;

    if (this.type === 'horizontal') {
      item.x = this.leftPad;
    } else {
      item.y = this.leftPad;
    }
  }

  // Override logical width/height to include padding and use STABLE content size
  public override get width(): number {
    if (this.type === 'horizontal') {
      return this.leftPad + this._contentWidth + this.rightPad;
    }
    return super.width;
  }

  public override get height(): number {
    if (this.type === 'vertical') {
      return this.leftPad + this._contentHeight + this.rightPad;
    }
    return super.height;
  }
}

export class CardHistoryLayout extends Container {
  private cardsHistoryBackground!: NineSliceSprite;
  private cardsHistoryMask!: Graphics;
  public list!: Container;
  public listYOffset: number = 0;
  public listXOffset: number = 0;
  public pushBackPadding: number = 0; // Padding from bottom when scrolling up (overflow)
  public listStartPadding: number = 0; // Fixed start padding for the list


  private options: CardHistoryLayoutOptions;

  private currentListScrollAnim: any = null; // Track full list scroll animation

  // We intentionally don't keep a separate array if List handles children,
  // but the user's logic might rely on access. We can access list.children.

  constructor(options: CardHistoryLayoutOptions = {}) {
    super();
    this.options = {
      type: 'horizontal',
      direction: 'ltr',
      ...options
    };
    // Default vertical direction to btt (bottom-to-top) if not specified but type is vertical? 
    // Actually standard List is 'vertical' -> TTB. 
    // If user wants BTT, they might say direction: 'btt'.

    this.createLayout();
  }

  private createLayout() {
    const listWidth = this.options.type === 'vertical' ? 150 : 300;
    const listHeight = this.options.type === 'vertical' ? 300 : 150;

    // --- background box ---
    this.cardsHistoryBackground = new NineSliceSprite({
      texture: Texture.from("Bar-history.png"),
      leftWidth: 35,
      topHeight: 35,
      rightWidth: 35,
      bottomHeight: 35,
    });
    this.cardsHistoryBackground.alpha = 0;
    this.cardsHistoryBackground.width = listWidth;
    this.cardsHistoryBackground.height = listHeight;
    this.addChild(this.cardsHistoryBackground);

    // --- create mask for the visible region ---
    this.cardsHistoryMask = new Graphics()
      .rect(
        0,
        0,
        listWidth,
        listHeight,
      )
      .fill(0xffffff); // fill color doesn't matter, mask only uses alpha
    this.addChild(this.cardsHistoryMask);

    // Apply mask ONLY to the list, so background remains visible
    // this.mask = this.cardsHistoryMask; 

    // --- Create Container (Replacing List to decouple Z-index sorting from X/Y Layout) ---
    this.list = new Container();

    this.list.mask = this.cardsHistoryMask;

    this.addChild(this.list);
  }

  public addCardToHistory(
    value: string,
    suit: string,
    action: GuessAction,
    leftPad: number = 0,
    rightPad: number = 0,
    _scrollMutiplier: number = 5,
    itemScale?: number,
    multiplier?: number,
    isWin?: boolean,
    animateSlide: boolean = true,
    isFaceDown: boolean = false,
    instantLayout: boolean = false
  ) {
    // 1. Create New Item
    const item = new CardHistoryItem(value, suit, action, multiplier, isWin, isFaceDown);


    const finalScale = itemScale ?? 1;
    const boostScale = finalScale * 1.1; // Newest card is 10% larger

    // Calculate centering offset for the boosted card
    // Since pivot serves as 0,0 (visually top-left), scaling down pushes visual center down.
    // We move Y up to compensate.
    const unscaledHeight = item.getLocalBounds().height;
    const centerOffset = (unscaledHeight * (boostScale - 1)) / 25;

    // 0. Scale down previous newest item (if exists)
    if (this.list.children.length > 0) {
      // Because we now ALWAYS physically add new items to the END of the `list.children` 
      // array to force them to render on top, the previous newest item is ALWAYS the last item.
      const prevIndex = this.list.children.length - 1;

      const lastWrapper = this.list.children[prevIndex] as Container;
      if (lastWrapper && lastWrapper.children.length > 0) {
        const prevItem = lastWrapper.children[0];
        gsap.to(prevItem.scale, {
          x: finalScale,
          y: finalScale,
          duration: 0.3,
          ease: "back.out",
        });
        // Reset position to 0 (top-aligned/normal)
        gsap.to(prevItem, {
          y: 0,
          duration: 0.3,
          ease: "back.out",
        });
      }
    }

    item.setBaseScale(finalScale);

    const itemWidth = item.getLocalBounds().width * finalScale;
    const itemHeight = item.getLocalBounds().height * finalScale;

    // Use GapContainer wrapper to handle per-item spacing
    const wrapper = new GapContainer(leftPad, rightPad, this.options.type ?? 'horizontal');
    wrapper.addItem(item, itemWidth, itemHeight);

    // Stop previous scroll animation if any to prevent fighting
    if (this.currentListScrollAnim) {
      this.currentListScrollAnim.kill();
      this.currentListScrollAnim = null;
    }

    // 3. Add to Container and Layout
    // We ALWAYS add to the end of the container so the newest element ALWAYS renders ON TOP.
    this.list.addChild(wrapper);

    // Manually layout children to replicate List behavior but decoupled from render order
    let currentX = 0;
    let currentY = 0;

    if (this.options.type === 'horizontal') {
      if (this.options.direction === 'ltr') {
        // Reverse iterate to place newest at 0, older to the right
        for (let i = this.list.children.length - 1; i >= 0; i--) {
          const child = this.list.children[i];
          child.x = currentX;
          currentX += child.width;
        }
        // Offset list to animate sliding
        this.list.x -= wrapper.width;
      } else {
        // Standard RTL
        for (let i = 0; i < this.list.children.length; i++) {
          const child = this.list.children[i];
          child.x = currentX;
          currentX += child.width;
        }
      }
    } else {
      if (this.options.direction === 'ttb') {
        for (let i = this.list.children.length - 1; i >= 0; i--) {
          const child = this.list.children[i];
          child.y = currentY;
          currentY += child.height;
        }
        this.list.y -= wrapper.height;
      } else {
        for (let i = 0; i < this.list.children.length; i++) {
          const child = this.list.children[i];
          child.y = currentY;
          currentY += child.height;
        }
      }
    }

    // 4. Trigger Item Entry Animations
    // "Pop In"
    item.alpha = 0;
    // Set initial scale/pos matches target (or start small)
    item.scale.set(boostScale * 0.5);
    // Start at centering position? Or 0?
    // If we want it to pop into center, we should animate Y to centerOffset.
    item.y = centerOffset; // Set initial Y to target offset so it doesn't jump?
    // Actually we animate entry.

    const popDuration = instantLayout ? 0 : 0.3;

    const animAlpha = gsap.to(item, {
      alpha: 1,
      duration: popDuration,
      ease: "linear",
    });
    item.trackAnimation(animAlpha as any);

    // Animate scale. Y position is constant (centerOffset) for the Big Card?
    // Yes, if we want it centered, it stays at centerOffset.
    // If we start scale small, centerOffset calculation differs?
    // No, if we fix Y at centerOffset, then as it scales up/down around Top-Left, visual center moves.
    // If we want Visual Center to be constant at Middle Line:
    // Middle Line Y = unscaledHeight/2.
    // At scale S, Visual Center Y = Ypos + (unscaledHeight/2 * S).
    // We want this == unscaledHeight/2 (Normal Item Center).
    // Ypos = unscaledHeight/2 * (1 - S).
    // This assumes we animate Y dynamically with Scale.
    // If we set Y to final offset, it will align at end.
    // During animation, it might wobble.
    // But aligning at end is most important.

    // So distinct animation for Y?
    // We set item.y = centerOffset (target) immediately?
    // Or animate it?
    // If we start at scale=0.5, offset would be different.
    // StartOffset = unscaledHeight/2 * (1 - 0.5*boost) approx.
    // Let's just animate Y from something to centerOffset.

    gsap.fromTo(item,
      { y: 0 },
      { y: centerOffset, duration: popDuration, ease: "back.out" }
    );

    const animScale = gsap.to(item.scale, {
      x: boostScale, // Target boosted scale
      y: boostScale,
      duration: popDuration,
      ease: "back.out",
    });
    item.trackAnimation(animScale as any);

    // "Fake Position" Slide In
    if (animateSlide) {
      let slideOffset = 0;
      if (this.options.type === 'vertical') {
        slideOffset = this.options.direction === 'ttb' ? -itemHeight - 20 : itemHeight + 20;
        item.animateEntry(slideOffset, 0.3);
      } else {
        slideOffset = this.options.direction === 'ltr' ? -itemWidth * 2 : itemWidth * 2;
        item.animateEntry(slideOffset, 0.3);
      }
    }

    // 5. Build Scroll / Overflow logic ("Push Back" / "Push Up")

    // Calculate needed scroll position to keep the new item visible.
    // We use requestAnimationFrame to ensure we read the List's dimensions AFTER PixiUI has updated the layout.
    requestAnimationFrame(() => {
      if (this.destroyed || !this.parent || !this.list.parent) return;

      // FIX: Do NOT use this.list.width/height directly. 
      // Pixi Container bounds are based on visual children (which are scaling from 0.5).
      // We need the TARGET layout size. Since we know List positions children sequentially,
      // we can find the extent by looking at the last child's position + its stable width.
      let listWidth = 0;
      let listHeight = 0;

      if (this.list.children.length > 0) {
        const lastChild = this.list.children[this.list.children.length - 1];
        // Accessing .width/.height on GapContainer uses our overridden stable getter
        if (this.options.type === 'vertical') {
          listHeight = lastChild.y + lastChild.height;
          // Calculate max width manually to avoid mask warning
          listWidth = 0;
          for (const child of this.list.children) {
            if (child.width > listWidth) listWidth = child.width;
          }
        } else {
          listWidth = lastChild.x + lastChild.width;
          // Calculate max height manually to avoid mask warning
          listHeight = 0;
          for (const child of this.list.children) {
            if (child.height > listHeight) listHeight = child.height;
          }
        }
      } else {
        listWidth = 0;
        listHeight = 0;
      }

      const visibleWidth = this.cardsHistoryBackground.width;
      const visibleHeight = this.cardsHistoryBackground.height;

      if (this.options.type === 'vertical') {
        // Vertical Logic
        let finalY = this.listStartPadding;

        if (this.options.direction === 'ttb') {
          finalY = this.listStartPadding;
        } else {
          // Check for Overflow
          if (listHeight + this.listStartPadding * 2 <= visibleHeight) {
            finalY = this.listStartPadding; // Align Top
          } else {
            // Align Bottom / Scroll Up
            finalY = visibleHeight - listHeight - this.pushBackPadding;
          }
        }

        this.currentListScrollAnim = gsap.to(this.list, {
          y: finalY + this.listYOffset,
          duration: instantLayout ? 0 : 0.3,
          ease: "back.out",
        });

        // Center X logic for vertical list
        // Use itemWidth instead of list.width because list.width might fluctuate due to entry animations (sliding in from X).
        this.list.x = visibleWidth / 2 - itemWidth / 2 + this.listXOffset;

      } else {
        // Horizontal Logic
        // Use itemHeight (target height) instead of item.heightScaled (current animating height) to prevent jumping
        this.list.y =
          visibleHeight / 2 - itemHeight / 2 + this.listYOffset; // Approximate centering

        let finalX = this.listStartPadding;

        if (this.options.direction === 'ltr') {
          finalX = this.listStartPadding;
        } else {
          const desiredX = visibleWidth - listWidth - this.pushBackPadding;
          finalX = Math.min(this.listStartPadding, desiredX);
        }

        this.currentListScrollAnim = gsap.to(this.list, {
          x: finalX + this.listXOffset,
          duration: instantLayout ? 0 : 0.3,
          ease: "back.out",
        });
      }
    });
  }

  public clearHistory() {
    // Stop global scroll animation immediately
    if (this.currentListScrollAnim) {
      this.currentListScrollAnim.kill();
      this.currentListScrollAnim = null;
    }

    // Create copy of children for safe iteration
    const children = [...this.list.children];

    // Remove from display list immediately to prevent weird state
    this.list.removeChildren();
    this.list.x = 0 + this.listXOffset; // Reset scroll with offset
    this.list.y = 0 + this.listYOffset; // Reset scroll with offset

    // Safely destroy children
    for (const child of children) {
      if (child instanceof Container && !child.destroyed) {
        child.destroy({ children: true });
      }
    }
  }

  public setSize(width: number, height: number) {
    this.resize(width, height);
  }

  public resize(width: number, height: number, _padding?: number) {
    const padding = _padding ?? 0;
    this.listStartPadding = padding;

    // --- Resize and position background ---
    this.cardsHistoryBackground.width = width;
    this.cardsHistoryBackground.height = height;

    // --- Update mask to match background ---
    // We add a small left padding to the MASK to cleanly clip any overflowing items on the left.
    // To change where the mask cuts off on the RIGHT side, modify `maskRightExtension` below.
    // 0 = cuts off exactly at the border. 100 = lets cards overlap 100px past the background edge.
    const maskLeftPadding = 3;
    const maskRightExtension = -5; // <--- Change this to hide cards sliding off the right side

    this.cardsHistoryMask
      .clear()
      .rect(
        maskLeftPadding,
        -50,
        width + maskRightExtension, // Right boundary logic
        height + 150, // height + bottom buffer + top buffer compensation
      )
      .fill(0xffffff);
    // Explicitly update hitArea or mask logic if needed, but Graphics mask works by geometry.

    if (this.options.type === 'vertical') {
      // For vertical:
      // 1. Center X
      this.list.x = width / 2 - this.list.width / 2 + this.listXOffset;

      // 2. Align Vertical
      let finalY = padding; // Default top alignment

      const contentHeight = this.list.height; // approximate content height

      if (this.options.direction === 'ttb') {
        finalY = padding;
      } else {
        // If content fits within visible height, align top.
        // If content exceeds visible height, align bottom to match "push up" behavior.
        if (contentHeight + padding * 2 <= height) {
          finalY = padding; // Start from top
        } else {
          // Overflow: Scroll to bottom (show newest items at bottom)
          // y = maxY = height - listHeight - padding
          finalY = height - contentHeight - this.pushBackPadding;
        }
      }

      this.list.y = finalY + this.listYOffset;
    } else {
      // Horizontal Logic
      // 1. Center Y
      // Use first child height for more stable centering if available, else container height
      const childHeight = this.list.children.length > 0 ? this.list.children[0].height : this.list.height;
      this.list.y = height / 2 - childHeight / 2 + this.listYOffset;

      // 2. Align Horizontal
      let finalX = padding;

      const contentWidth = this.list.width;

      if (this.options.direction === 'ltr') {
        finalX = padding;
      } else {
        if (contentWidth + padding * 2 <= width) {
          finalX = padding;
        } else {
          // Align to the extended right edge
          const effectiveWidth = width + maskRightExtension;
          finalX = effectiveWidth - contentWidth - this.pushBackPadding;
        }
      }

      this.list.x = finalX + this.listXOffset;
    }
  }
}
