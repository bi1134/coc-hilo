import { Container, Sprite, Texture } from "pixi.js";
import { gsap } from "gsap"; // Using GSAP directly
import { engine } from "../getEngine";
import { BitmapLabel } from "../ui/BitmapLabel";
//import { RoundedBox } from "../ui/RoundedBox";
import { FancyButton } from "@pixi/ui";
import { Spine } from "@esotericsoftware/spine-pixi-v8";
import { LayoutHelper } from "../utils/LayoutHelper";
import { NumberAnimator } from "../utils/NumberAnimator";

export enum CashOutAnimationState {
  Idle = "idle",
  Action = "appear",
}

/** Popup that shows up when gameplay is paused */
export class ResultPopup extends Container {
  /** The dark semi-transparent background covering current screen */
  private bg: Sprite;
  /** Container for the popup UI components */
  private panel: Container;
  /** The popup title label */
  private title: BitmapLabel;
  /** The panel background */
  private panelBase?: Spine;

  private resultLabel: BitmapLabel;

  private youWinLabel: BitmapLabel;

  private invisButton: FancyButton;

  // Track active number animation tweens so we can skip-to-end on early close
  private _multiplierTween: gsap.core.Tween | null = null;
  private _totalTween: gsap.core.Tween | null = null;
  private _finalMultiplier: number = 0;
  private _finalTotal: number = 0;

  // Container for safe area scaling
  private safeArea: Container;

  constructor() {
    super();

    // 1. Background Overlay
    this.bg = new Sprite(Texture.WHITE);
    this.bg.tint = 0x000000;
    this.bg.interactive = true; // Block clicks
    this.bg.alpha = 0;
    this.addChild(this.bg);

    this.safeArea = new Container();
    this.addChild(this.safeArea);

    this.panel = new Container();
    this.safeArea.addChild(this.panel);

    // Assets are preloaded in NextScreen.ts
    this.panelBase = Spine.from({
      skeleton: "/spine-assets/cash-out.skel",
      atlas: "/spine-assets/cash-out.atlas",
    });

    // Initialize animation
    console.log("ResultPopup Animations:", this.panelBase.skeleton.data.animations.map(a => a.name));

    if (this.visible) {
      this.runAppearAnimation();
    } else {
      this.panelBase.state.setAnimation(0, CashOutAnimationState.Idle, true);
    }

    this.panel.addChildAt(this.panelBase, 0); // Background


    this.title = new BitmapLabel({
      text: "1.25x",
      style: { fontSize: 30, fontFamily: "cocgr-bitmap", letterSpacing: -2 },
    });
    this.title.y = -80;
    this.panel.addChild(this.title);

    // --- result background removed as per request ---

    // --- result label ---
    this.resultLabel = new BitmapLabel({
      text: "0.13", // placeholder
      style: {
        fill: 0xffffff,
        fontSize: 40,
        fontFamily: "coccm-bitmap-3-normal",
        align: "center",
        letterSpacing: -2,
      },
    });
    this.resultLabel.anchor.set(0.5);
    this.panel.addChild(this.resultLabel);

    // --- you win label ---
    this.youWinLabel = new BitmapLabel({
      text: "You Win!", // placeholder
      style: {
        fill: 0xffffff,
        fontSize: 40,
        fontFamily: "coccm-bitmap-3-normal",
        align: "center",
        letterSpacing: -2,
      },
    });
    this.youWinLabel.anchor.set(0.5);
    this.panel.addChild(this.youWinLabel);

    this.invisButton = new FancyButton({
      defaultView: "rounded-rectangle.png",
      anchor: 0.5,
      width: 100, // placeholder
      height: 100,
    });
    this.invisButton.alpha = 0;
    this.safeArea.addChild(this.invisButton); // Add to safe area to cover content
    this.invisButton.onPress.connect(() => {
      // Kill all pending text pop-in animations and snap to final state
      gsap.killTweensOf(this.title);
      gsap.killTweensOf(this.title.scale);
      gsap.killTweensOf(this.youWinLabel);
      gsap.killTweensOf(this.youWinLabel.scale);
      gsap.killTweensOf(this.resultLabel);
      gsap.killTweensOf(this.resultLabel.scale);
      this.title.alpha = 1; this.title.scale.set(1);
      this.youWinLabel.alpha = 1; this.youWinLabel.scale.set(1);
      this.resultLabel.alpha = 1; this.resultLabel.scale.set(1);

      // Skip number rolling animations to final values
      if (this._multiplierTween) {
        this._multiplierTween.kill();
        this._multiplierTween = null;
        this.title.text = `${this._finalMultiplier % 1 === 0 ? this._finalMultiplier.toFixed(0) : this._finalMultiplier.toFixed(2)}x`;
      }
      if (this._totalTween) {
        this._totalTween.kill();
        this._totalTween = null;
        const fmt = this._finalTotal % 1 === 0
          ? this._finalTotal.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
          : this._finalTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        (this.resultLabel as any).text = `RP ${fmt}`;
      }
      engine().navigation.dismissPopup();
    });
  }

  public setResult(multiplier: number, baseAmount: number) {
    const total = baseAmount * multiplier;
    this._finalMultiplier = multiplier;
    this._finalTotal = total;

    // Animate the multiplier text (e.g. from 0x to 1.50x)
    this._multiplierTween = NumberAnimator.animate(this.title, 0, multiplier, 1.5, "", "x", 2);

    // Animate the money total (e.g. from RP 0 to RP 1,500.00)
    this._totalTween = NumberAnimator.animate(this.resultLabel as any, 0, total, 1.5, "RP ", "", 2);
  }

  /** Resize the popup, fired whenever window size changes */
  public resize(width: number, height: number) {
    // --- Resize BG ---
    this.bg.width = width;
    this.bg.height = height;

    // --- Safe Area Scaling (Match MobileLayout) ---
    const SAFE_WIDTH = 1075;
    const SAFE_HEIGHT = 1920;

    // Calculate scale to fit (Contain) within the window
    const scale = Math.min(width / SAFE_WIDTH, height / SAFE_HEIGHT);

    this.safeArea.scale.set(scale);
    this.safeArea.x = (width - SAFE_WIDTH * scale) / 2;
    this.safeArea.y = (height - SAFE_HEIGHT * scale) / 2;

    // Now treat safeArea as 1075x1920 space.
    // Center panel in safe area
    this.panel.x = SAFE_WIDTH / 2;
    this.panel.y = SAFE_HEIGHT / 2;



    const panelWidth = SAFE_WIDTH * 0.9;

    if (this.panelBase) {
      this.panelBase.scale.set(1.5);
      this.panelBase.position.set(0, -150);
    }


    this.title.x = 0;
    // Put title near top of spine
    this.title.y = 80; // Padding from top edge

    this.youWinLabel.x = 0;
    this.youWinLabel.y = 180; // Padding from top edge

    this.resultLabel.x = 0;
    this.resultLabel.y = 250; // Slightly below center? Or bottom?

    // Invis button covers the whole safe Area (effectively blocking clicks on game, but user can click anywhere in safe area to close?)
    if (this.invisButton.parent !== this) {
      this.addChild(this.invisButton);
    }
    this.invisButton.width = width;
    this.invisButton.height = height;
    this.invisButton.x = width / 2;
    this.invisButton.y = height / 2;

  }

  private runAppearAnimation() {
    if (!this.panelBase) return;

    const entry = this.panelBase.state.setAnimation(0, CashOutAnimationState.Action, false);
    this.panelBase.state.addAnimation(0, CashOutAnimationState.Idle, true, 0);

    let isTextShown = false;
    const showText = () => {
      if (isTextShown) return;
      isTextShown = true;

      console.log("ResultPopup: showText called");

      gsap.to(this.title, { alpha: 1, duration: 0.1 });
      gsap.to(this.title.scale, { x: 1, y: 1, duration: 0.2, ease: "back.out(2)" });

      gsap.delayedCall(0.1, () => {
        gsap.to(this.youWinLabel, { alpha: 1, duration: 0.1 });
        gsap.to(this.youWinLabel.scale, { x: 1, y: 1, duration: 0.2, ease: "back.out(2)" });
      });

      gsap.delayedCall(0.2, () => {
        gsap.to(this.resultLabel, { alpha: 1, duration: 0.1 });
        gsap.to(this.resultLabel.scale, { x: 1, y: 1, duration: 0.2, ease: "back.out(2)" });
      });
    };

    if (entry && entry.animation) {
      const duration = entry.animation.duration;

      gsap.delayedCall(duration * 0.3, showText);
    } else {
      console.warn("ResultPopup: Animation entry invalid or not found for", CashOutAnimationState.Action);
      showText();
    }

    // Failsafe
    setTimeout(() => {
      if (!isTextShown) {
        showText();
      }
    }, 2000);
  }

  public async show() {

    // Safety Force Resize
    const { width, height } = engine().screen;
    this.resize(width, height);

    // Initial State
    this.bg.alpha = 0;
    this.panel.scale.set(0.5);
    this.visible = true;

    // Reset text visibility
    this.title.alpha = 0;
    this.title.scale.set(0);
    this.resultLabel.alpha = 0;
    this.resultLabel.scale.set(0);
    this.youWinLabel.alpha = 0;
    this.youWinLabel.scale.set(0);

    if (this.panelBase) {
      this.runAppearAnimation();
    } else {
      // Fallback if spine not loaded
      this.title.alpha = 1;
      this.title.scale.set(1);
      this.resultLabel.alpha = 1;
      this.resultLabel.scale.set(1);
      this.youWinLabel.alpha = 1;
      this.youWinLabel.scale.set(1);
    }

    // --- Background fade in ---
    gsap.to(this.bg, {
      alpha: 0.8,
      duration: 0.2,
      ease: "power2.out",
    });

    // --- Panel "pop in" effect (Clash Royale style) ---
    await gsap.to(this.panel.scale, {
      x: 1,
      y: 1,
      duration: 0.1,
      ease: "back.out",
    });
    // wait 2 seconds (non-blocking for animation but blocking for hide?)
    // If we want it to auto-hide:
    setTimeout(() => {
      this.hide().then(() => engine().navigation.dismissPopup());
    }, 10000);
  }

  /** Dismiss the popup, animated */
  public async hide() {


    // --- Panel "pop out" / shrink away ---
    await gsap.to(this.panel.scale, {
      x: 0.5,
      y: 0.5,
      duration: 0.3,
      ease: "back.in(1.7)",
    });

    // Parallel fade out
    gsap.to(this.panel, { alpha: 0, duration: 0.2 });

    // Fade out the background
    await gsap.to(this.bg, {
      alpha: 0,
      duration: 0.2,
    });

    this.visible = false;
  }
}
