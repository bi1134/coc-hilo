import { BitmapText, Container, Sprite } from "pixi.js";

import { GuessAction } from "../screens/next/types/GameTypes";
import { gsap } from "gsap";
import { Label } from "./Label";

export class CardHistoryItem extends Container {
  private innerContainer: Container;
  private cardSprite!: Sprite;
  private actionSprite!: Sprite;
  private multiplierTextLabel!: Label;
  private multiplierBackground!: Sprite;

  private _rank!: string;
  private _suit!: string;
  private _action!: GuessAction;

  public get value(): string {
    return this._rank;
  }
  public get suit(): string {
    return this._suit;
  }
  public get action(): GuessAction {
    return this._action;
  }

  private _invertActionPlacement: boolean = false;

  // public targetX: number = 0; // Removed: Handled by PixiUI List

  constructor(rank: string, suit: string, action: GuessAction, multiplier?: number, isWin?: boolean, isFaceDown: boolean = false, invertActionPlacement: boolean = false) {
    super();

    // --- Create inner container for local animations
    this.innerContainer = new Container();
    this.innerContainer.sortableChildren = true;
    this.sortableChildren = true; // Make root sortable too
    this.addChild(this.innerContainer);

    this.Setup(rank, suit, action, multiplier, isWin, isFaceDown, invertActionPlacement);
  }

  private Setup(rank: string, suit: string, action: GuessAction, multiplier?: number, isWin?: boolean, isFaceDown: boolean = false, invertActionPlacement: boolean = false) {
    // Clear previous if reusing
    this.innerContainer.removeChildren();

    // Remove action sprite if reusing
    if (this.actionSprite && this.actionSprite.parent) {
      this.actionSprite.parent.removeChild(this.actionSprite);
    }

    this._rank = rank;
    this._suit = suit;
    this._action = action;
    this._invertActionPlacement = invertActionPlacement;

    // --- tray background (behind card) ---
    const trayTexture = (isWin ?? true) ? "Tray-Green.png" : "Tray-Red.png";
    this.multiplierBackground = Sprite.from(trayTexture);
    this.multiplierBackground.zIndex = 1;
    this.innerContainer.addChild(this.multiplierBackground);

    // --- card sprite ---
    const textureName = isFaceDown ? "card-back.png" : `${this._suit}-card-${this._rank.toLowerCase()}.png`;
    this.cardSprite = Sprite.from(textureName);
    this.cardSprite.zIndex = 2;
    this.innerContainer.addChild(this.cardSprite);

    // --- action sprite ---
    const actionTexture = this.ActionToIcon(this._action, isWin);
    this.actionSprite = Sprite.from(actionTexture);
    this.actionSprite.zIndex = 100; // Force to very top locally
    if (this._action === GuessAction.Start) {
      this.actionSprite.alpha = 0;
    }
    this.actionSprite.anchor.set(0.5);
    // Add directly to item root, outside innerContainer to prevent slide-in masking/sorting issues
    this.addChild(this.actionSprite);

    let labelText = "";
    if (action === GuessAction.Start) {
      labelText = "Start";
    } else if (multiplier !== undefined) {
      labelText = `${multiplier}x`;
    }

    this.multiplierTextLabel = new Label({
      text: labelText,
      style: {
        fontSize: 40,
        fontFamily: "SVN-Supercell Magic",
        align: "center",
        fill: "#ffffffff",
        dropShadow: {
          color: "#000000",
          blur: 1,
          distance: 4,
          angle: 90 * (Math.PI / 180),
        },
        stroke: {
          color: "#000000",
          width: 9,
        },
        padding: 20, // Prevent clipping
      },
    });
    this.multiplierTextLabel.zIndex = 100; // Place firmly on top
    this.addChild(this.multiplierTextLabel);

    if (isFaceDown) {
      this.multiplierBackground.alpha = 0;
      this.actionSprite.alpha = 0;
      this.multiplierTextLabel.alpha = 0;
    }

    this.updateLayout();
  }

  //guess enum to icon texture name
  private ActionToIcon(action: GuessAction, isWin: boolean = true): string {
    const prefix = isWin ? "Icon-green" : "Icon-red";

    switch (action) {
      case GuessAction.Higher:
        return `${prefix}-3.png`; // Higher
      case GuessAction.HigherOrEqual:
        return `${prefix}-0.png`; // HigherOrEqual
      case GuessAction.Lower:
        return `${prefix}-2.png`; // Lower
      case GuessAction.LowerOrEqual:
        return `${prefix}-1.png`; // LowerOrEqual

      case GuessAction.Equal:
        return "icon-equal.png"; // Keep standard or map? User didn't specify.

      case GuessAction.Skip:
        return "icon-skip.png";
      case GuessAction.Start:
        return `${prefix}-3.png`; // Use Higher icon as default/start?
      default:
        return "blank-icon.jpg";
    }
  }

  public updateLayout() {
    // --- Layout internal parts relative to this item’s origin ---
    // Tray is behind card, assume centered on card or card centered on it?
    // User said "behind the card". Usually implies card is on top.

    // Scale tray to match card width (assuming tray texture might be different res)
    if (this.cardSprite.texture.width > 1 && this.multiplierBackground.texture.width > 1) {
      const scale = this.cardSprite.width / this.multiplierBackground.texture.width + 0.1;
      this.multiplierBackground.scale.set(scale);
    } else {
      // Fallback if textures not ready (though they should be preloaded)
      // This ensures we don't divide by zero or get weird results
      this.multiplierBackground.scale.set(1);
    }

    this.multiplierBackground.anchor.set(0.5);
    this.cardSprite.anchor.set(0.5);

    // Center both
    this.cardSprite.x = 0;
    this.cardSprite.y = 0;

    this.multiplierBackground.x = 0;
    this.multiplierBackground.y = 0; // Using anchor 0.5 for both implies they overlap perfectly center-to-center

    // Since we changed anchor to 0.5, we might need to adjust parent positioning expectation if it relied on top-left (0,0)
    // List elements usually expect top-left at 0,0 locally?
    // If I shift them to 0,0 with anchor 0.5, the visual top-left will be (-w/2, -h/2).
    // Let's shift them positively so top-left is roughly 0,0.

    const maxWidth = Math.max(this.cardSprite.width, this.multiplierBackground.width);
    const maxHeight = Math.max(this.cardSprite.height, this.multiplierBackground.height);

    this.cardSprite.x = maxWidth / 2;
    this.cardSprite.y = maxHeight / 2;
    this.multiplierBackground.x = maxWidth / 2;
    this.multiplierBackground.y = maxHeight / 2;

    // Action Sprite (Arrow)
    this.actionSprite.scale.set(3);
    
    if (this._invertActionPlacement) {
      this.actionSprite.x = this.cardSprite.x - this.cardSprite.width / 1.65;
    } else {
      this.actionSprite.x = this.cardSprite.x + this.cardSprite.width / 1.65;
    }
    
    this.actionSprite.y = this.multiplierBackground.y; // Center on card? Or offset?
    // If "action sprite" was the arrow, keeping it centered on card is standard for "Result" overlays.
    this.multiplierTextLabel.position.set(
      this.multiplierBackground.x,
      this.multiplierBackground.y + this.multiplierBackground.height / 2 - this.multiplierTextLabel.height / 2 + 3 // Near bottom
    );
    // If tray covers card, text should be visible.
  }

  public get widthScaled(): number {
    return Math.max(this.cardSprite.width, this.multiplierBackground.width) * this.scale.x;
  }

  public get heightScaled(): number {
    return (
      (Math.max(this.cardSprite.height, this.multiplierBackground.height)) * this.scale.y
    );
  }

  public setBaseScale(scale: number) {
    this.scale.set(scale);
  }

  // Track active animations so we can stop them on destroy
  private activeAnimations: gsap.core.Tween[] = [];

  /**
   * Animates the entry of the card content (slide in from right/offset).
   * @param startOffset The X offset to start from (relative to 0)
   * @param duration Duration in seconds
   */
  public animateEntry(startOffset: number, duration: number) {
    // Set initial position
    this.innerContainer.x = startOffset;

    // Animate to 0
    const anim = gsap.to(this.innerContainer, {
      x: 0,
      duration: duration,
      ease: "back.out",
    });
    this.trackAnimation(anim);
  }

  public trackAnimation(anim: gsap.core.Tween) {
    this.activeAnimations.push(anim);
    anim.then(() => {
      const index = this.activeAnimations.indexOf(anim);
      if (index > -1) {
        this.activeAnimations.splice(index, 1);
      }
    });
  }

  // --- clean up resources ---
  public override destroy(options?: {
    children?: boolean;
    texture?: boolean;
    baseTexture?: boolean;
  }) {
    // STOP ALL ANIMATIONS
    this.activeAnimations.forEach((anim) => {
      anim.kill();
    });
    this.activeAnimations = [];

    // explicit safety check to avoid double-destroy issues
    if (this.destroyed) return;

    // explicitly destroy all children (to ensure Label and Graphics are cleaned up)
    this.innerContainer?.destroy({ children: true });

    // We don't need to destroy sprites individually if we destroy innerContainer with children:true,
    // but keeping it explicit doesn't hurt if we want to be safe.
    // Actually, best to just let Container destroy children.

    // null references
    this.cardSprite = null!;
    this.actionSprite = null!;
    this.multiplierBackground = null!;
    this.multiplierTextLabel = null!;
    this.innerContainer = null!;

    // finally call the parent destroy
    super.destroy(options);
  }
}
