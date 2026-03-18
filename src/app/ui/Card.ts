import { GlareFilter } from "../filters/GlareFilter";
import { Spine } from "@esotericsoftware/spine-pixi-v8";
import {
  ColorMatrixFilter,
  Container,
  PerspectiveMesh,
  Texture,
  Ticker,
  Rectangle,
} from "pixi.js";
import { gsap } from "gsap";

export type CardSuit = "spade" | "heart" | "club" | "diamond";
export enum AnimationState {
  Idle = "idle",
  Flip = "flip",
  StartIdle = "idle-start",
  Face = "card-face"
}

export class Card extends Container {
  private spineCard: Spine;
  private mesh: PerspectiveMesh;
  private shadow: PerspectiveMesh;

  // Glare components
  private glareFilter: GlareFilter;

  private _rank: string = "A";
  private _suit: CardSuit = "spade";

  private ranks = [
    "A",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "10",
    "J",
    "Q",
    "K",
  ];
  private suits: CardSuit[] = ["spade", "heart", "club", "diamond"];

  private angleX = 0;
  private angleY = 0;
  private targetX = 0;
  private targetY = 0;
  private readonly maxAngle = 10;
  private readonly perspective = 400;

  private hovering = false;
  private baseWidth: number;
  private baseHeight: number;
  private baseScale = 1;

  constructor() {
    super();


    // DEBUG: Transparency & Resolution check (delayed)
    setTimeout(() => {
      try {
        if (!this.spineCard) return;
        // @ts-ignore
        const slot = this.spineCard.skeleton.findSlot("card-front") || this.spineCard.skeleton.slots[0];
        const att = slot?.getAttachment();
        console.log("DEBUG: Spine Attachment:", att?.name);
        console.log("DEBUG: Active Skin:", this.spineCard.skeleton.skin?.name);
      } catch (e) { console.error("DEBUG ERR:", e); }
    }, 2000);

    const texture = Texture.from("main/cards/spade-card-a.png");
    // Shadow as Mesh
    this.shadow = new PerspectiveMesh({
      texture: Texture.from("card-shadow.png"),
      width: texture.width,
      height: texture.height,
    });
    // Offset shadow relative to center, similar to how we previously positioned sprite
    // But PerspectiveMesh coordinate system usually relies on setCorners.
    // For now, let's add it. We'll handle positioning via corners or container offset?
    // Using container offset for shadow mesh is easiest if consistent.

    this.mesh = new PerspectiveMesh({
      texture,
      width: texture.width,
      height: texture.height,
    });

    this.baseWidth = texture.width;
    this.baseHeight = texture.height;

    // Center mesh visually
    this.mesh.x = -this.baseWidth / 2;
    this.mesh.y = -this.baseHeight / 2;

    // Shadow offset - we can offset the mesh instance itself
    this.shadow.x = this.mesh.x;
    this.shadow.y = this.mesh.y;

    this.addChild(this.shadow);
    this.addChild(this.mesh);

    // --- Glare Setup ---
    // Use GlareFilter on the mesh
    this.glareFilter = new GlareFilter();
    this.glareFilter.padding = 100; // Extra padding for chopped edges
    this.glareFilter.resolution = window.devicePixelRatio || 1; // High res
    this.glareFilter.antialias = "on"; // Force AA on the filter's render texture

    this.glareFilter.progress = 0; // Start off-screen
    this.glareFilter.alpha = 0;

    // Apply filter to mesh
    this.mesh.filters = [this.glareFilter];

    //make the card "hitbox" bigger
    this.setHoverPadding(15);

    // make Spine visually match the mesh’s center alignment
    // this.spineCard.scale.set(1); // Moved to load callback
    // this.spineCard.x = 0;
    // this.spineCard.y = 0;

    // ensure mesh is hidden initially
    this.mesh.visible = false;
    this.shadow.visible = false;

    // initial texture update (to match default A spade)
    this.UpdateTexture();

    // Initialize Spine synchronously (Assets are preloaded in NextScreen.ts)
    // Create the Spine instance
    console.log("[Card] Initializing Spine Card...");

    // DEBUG: Check if assets are actually in cache
    import("pixi.js").then(({ Assets }) => {
      const skelLoaded = Assets.cache.has("/spine-assets/Card.skel");
      const atlasLoaded = Assets.cache.has("/spine-assets/Card.atlas");
      console.log(`[Card] Asset Cache Check - Skel: ${skelLoaded}, Atlas: ${atlasLoaded}`);

      if (!skelLoaded || !atlasLoaded) {
        console.error("[Card] CRITICAL: Spine assets NOT found in cache! Preloading failed or race condition?");
      }
    });

    this.spineCard = Spine.from({
      skeleton: "/spine-assets/Card.skel",
      atlas: "/spine-assets/Card.atlas",
    });

    this.spineCard.state.setAnimation(0, AnimationState.Idle, true);
    this.addChild(this.spineCard);
    console.log("Card Animations:", this.spineCard.skeleton.data.animations.map(a => a.name));

    // Re-apply visibility/transform settings
    this.spineCard.visible = !this.mesh.visible;
    this.spineCard.scale.set(1);
    this.spineCard.x = 0;
    this.spineCard.y = 0;

    // Trigger texture update to set initial skin
    this.UpdateTexture();

    // DEBUG: Inspect loaded spine data
    console.log("Spine Card Debug: Loaded!");
    console.log("Skin:", this.spineCard.skeleton.skin?.name);
    const slot = this.spineCard.skeleton.slots[0];
    const attachment = slot?.getAttachment();
    console.log("Slot 0 Attachment:", attachment?.name);

    // --- Interactivity ---
    this.eventMode = "static";
    this.interactive = true;

    this.on("pointermove", this.onPointerMove.bind(this));
    this.on("pointerover", this.onPointerOver.bind(this));
    this.on("pointerout", this.onPointerOut.bind(this));

    this.tiltLoop(); // keep the follow system always running
  }


  // --- same API as before ---
  public RandomizeValue(playFlip: boolean = true): void {
    this._rank = this.ranks[Math.floor(Math.random() * this.ranks.length)];
    this._suit = this.suits[Math.floor(Math.random() * this.suits.length)];
    this.UpdateTexture(playFlip);
  }

  public GetNumericValue(): number {
    return this.ranks.indexOf(this._rank);
  }

  public SetValue(rank: string, suit: CardSuit, playFlip: boolean = true): void {
    this._rank = rank;
    this._suit = suit;
    this.UpdateTexture(playFlip);
  }

  private lastWidth = 0;
  private lastHeight = 0;

  private UpdateTexture(playFlip: boolean = true): void {
    // build texture file name
    const textureName = `${this._suit}-card-${this._rank.toLowerCase()}.png`;
    this.mesh.texture = Texture.from(textureName);

    // match mesh size with texture
    this.baseWidth = this.mesh.texture.width;
    this.baseHeight = this.mesh.texture.height;
    this.mesh.x = -this.baseWidth / 2;
    this.mesh.y = -this.baseHeight / 2;

    // Optimize: Only regenerate shadow/mask if size changed (or initialized)
    const sizeChanged = this.baseWidth !== this.lastWidth || this.baseHeight !== this.lastHeight;

    if (sizeChanged) {
      this.lastWidth = this.baseWidth;
      this.lastHeight = this.baseHeight;

      // With PerspectiveMesh, size is largely handled by setCorners in tiltLoop using baseWidth/Height
      // But we might need to update base mesh dimensions if texture resizable?
      // For now, assuming tiltLoop handles visual shape.

      this.setHoverPadding(15); // refresh hitbox if size changed
    }

    // spine skin name convention
    // e.g. "spade-a", "heart-10", "diamond-k"
    const skinName = `${this._suit}-${this._rank.toLowerCase()}`;

    if (this.spineCard && this.spineCard.skeleton) {
      try {
        this.spineCard.skeleton.setSkinByName(skinName);
        this.spineCard.skeleton.setSlotsToSetupPose();

        if (playFlip) {
          // Animation Sequence: Flip -> StartIdle -> Idle
          this.spineCard.state.setAnimation(0, AnimationState.Flip, false);
          this.spineCard.state.addAnimation(0, AnimationState.StartIdle, false, 0);
          this.spineCard.state.addAnimation(0, AnimationState.Idle, true, 0);
        } else {
          // Force Idle instantly
          this.spineCard.state.setAnimation(0, AnimationState.Idle, true);
        }

      } catch (e) {
        console.warn(`Spine skin '${skinName}' not found.`);
      }
    }
  }



  // ========== LOGIC ==========

  private onPointerMove(e: any): void {
    const local = e.getLocalPosition(this.mesh);
    const nx = (local.x / this.baseWidth) * 2 - 1;
    const ny = (local.y / this.baseHeight) * 2 - 1;

    this.targetX = ny * this.maxAngle;
    this.targetY = -nx * this.maxAngle;
  }

  private async onPointerOver(): Promise<void> {
    if (this.hovering) return;
    this.hovering = true;

    // swap visible targets
    if (this.spineCard) this.spineCard.visible = false;
    this.mesh.visible = true;
    this.shadow.visible = true;

    // play hover animations
    this.playTiltSequence();
    this.playLiftSequence();
    this.playGlare();
  }

  private playGlare() {
    // Reset glare
    this.glareFilter.progress = 0;
    this.glareFilter.alpha = 1;

    gsap.killTweensOf(this.glareFilter); // We tween the filter object directly (proxy properties)

    // Sweep animation
    gsap.to(this.glareFilter, {
      progress: 1,
      duration: 1.0,
      ease: "power2.out",
    });

    // Fade out at end
    gsap.to(this.glareFilter, {
      alpha: 0,
      duration: 0.3,
      delay: 0.7,
      ease: "power1.in"
    });
  }

  // Controls if we should stay in mesh mode even after pointer out
  public forceMeshView = false;

  private onPointerOut(): void {
    this.hovering = false;
    this.targetX = 0;
    this.targetY = 0;

    // Immediately kill any active or queued animations from the 'Over' state
    gsap.killTweensOf(this);       // stops angle/tilt animations
    gsap.killTweensOf(this.scale); // stops lift/scale animations

    // Kill glare
    gsap.killTweensOf(this.glareFilter);
    this.glareFilter.alpha = 0;
    this.glareFilter.progress = 0;

    this.resetScale();

    // swap back ONLY if not forced to stay in mesh view
    if (!this.forceMeshView) {
      this.shadow.visible = false;
      this.mesh.visible = false;
      if (this.spineCard) this.spineCard.visible = true;
    }
  }



  public async playLoseAnimation() {
    // Wait for Flip animation if it is currently playing
    if (this.spineCard) {
        const track = this.spineCard.state.getCurrent(0);
        if (track && track.animation.name === AnimationState.Flip) {
            const timeRemaining = (track.animation.duration - track.trackTime) * 1000;
            if (timeRemaining > 0) {
                await new Promise(resolve => setTimeout(resolve, timeRemaining));
            }
        }
    }

    // Force switch to mesh/shadow view
    if (this.spineCard) this.spineCard.visible = false;
    this.mesh.visible = true;
    this.shadow.visible = true;

    // Play hover-like sequence (Tilt, Lift, Glare)
    const tilt = this.playTiltSequence();
    const lift = this.playLiftSequence();
    this.playGlare();

    await Promise.all([tilt, lift]);

    // Small pause before settling back
    await new Promise(resolve => setTimeout(resolve, 100));

    // Lerp back to base scale (original size)
    this.resetScale();
  }

  public resetToIdle() {
    this.forceMeshView = false;
    this.hovering = false;
    this.shadow.visible = false;
    this.mesh.visible = false;
    if (this.spineCard) {
      this.spineCard.visible = true;

      // Don't interrupt a Flip that's already playing — let it finish naturally
      const track = this.spineCard.state.getCurrent(0);
      const isFlipping = track?.animation && track.animation.name === AnimationState.Flip;
      if (!isFlipping) {
        this.spineCard.state.setAnimation(0, AnimationState.Idle, true);
      }
    }
    this.resetScale();
  }

  // ===== ANIMATION ========

  private tiltLoop(): void {
    const points = [
      { x: 0, y: 0 },
      { x: this.baseWidth, y: 0 },
      { x: this.baseWidth, y: this.baseHeight },
      { x: 0, y: this.baseHeight },
    ];
    const outPoints = points.map((p) => ({ ...p }));

    const rotate3D = (angleX: number, angleY: number) => {
      const radX = (angleX * Math.PI) / 180;
      const radY = (angleY * Math.PI) / 180;
      const cosX = Math.cos(radX);
      const sinX = Math.sin(radX);
      const cosY = Math.cos(radY);
      const sinY = Math.sin(radY);

      // Card corners
      for (let i = 0; i < 4; i++) {
        const src = points[i];
        const out = outPoints[i];
        const x = src.x - this.baseWidth / 2;
        const y = src.y - this.baseHeight / 2;
        let z = 0;

        // Rotate Y
        const xY = cosY * x - sinY * z;
        z = sinY * x + cosY * z;

        // Rotate X
        const yX = cosX * y + sinX * z;
        z = -sinX * y + cosX * z;

        const scale = this.perspective / (this.perspective - z);
        out.x = xY * scale + this.baseWidth / 2;
        out.y = yX * scale + this.baseHeight / 2;
      }

      this.mesh.setCorners(
        outPoints[0].x,
        outPoints[0].y,
        outPoints[1].x,
        outPoints[1].y,
        outPoints[2].x,
        outPoints[2].y,
        outPoints[3].x,
        outPoints[3].y,
      );
      // Sync shadow corners (Z-depth based offset)
      // Simulating light from Top-Left, shadow to South-East
      const shadowOffsetX = 5;
      const shadowOffsetY = 5;
      const zStrength = 0.07;

      const sOutPoints = points.map(() => ({ x: 0, y: 0 }));

      for (let i = 0; i < 4; i++) {
        const src = points[i];
        const out = sOutPoints[i];
        const x = src.x - this.baseWidth / 2;
        const y = src.y - this.baseHeight / 2;
        let z = 0;

        // Rotate Y
        const xY = cosY * x - sinY * z;
        z = sinY * x + cosY * z;

        // Rotate X
        const yX = cosX * y + sinX * z;
        z = -sinX * y + cosX * z;

        // Z positive = closer to viewer (lifted) -> Larger offset
        // Z negative = further from viewer (pressed) -> Smaller offset
        const heightFactor = Math.max(0, 1 + z * zStrength);

        const offX = shadowOffsetX * heightFactor;
        const offY = shadowOffsetY * heightFactor;

        // Use NORMAL projection (xY, yX) matching the card mesh
        const scale = this.perspective / (this.perspective - z);

        // Apply projection + offset
        out.x = (xY * scale + this.baseWidth / 2) + offX;
        out.y = (yX * scale + this.baseHeight / 2) + offY;
      }

      this.shadow.setCorners(
        sOutPoints[0].x,
        sOutPoints[0].y,
        sOutPoints[1].x,
        sOutPoints[1].y,
        sOutPoints[2].x,
        sOutPoints[2].y,
        sOutPoints[3].x,
        sOutPoints[3].y,
      );
    };

    const tiltSpeed = 0.15;
    const ticker = Ticker.shared;

    ticker.add(() => {
      this.angleX += (this.targetX - this.angleX) * tiltSpeed * 2;
      this.angleY += (this.targetY - this.angleY) * tiltSpeed * 2;
      rotate3D(this.angleX, this.angleY);
    });
  }

  //one time tilt seq
  private async playTiltSequence() {
    // tilt left -> right -> center
    // Using angle (2D rotation) as per previous implication, but correcting source to angle
    // If previous code read angleY, it might have been using it as a "close enough" 0 start?
    // I'll animate 'angle' (2D z-rotation) for the shake effect.
    const tiltAngle = 3;
    await gsap.to(this, {
      angle: -tiltAngle,
      duration: 0.05,
      ease: "power1.out",
    });
    await gsap.to(this, {
      angle: tiltAngle,
      duration: 0.05,
      ease: "power1.out",
    });
    await gsap.to(this, { angle: 0, duration: 0.05, ease: "power1.out" });
  }

  //lift effect
  private async playLiftSequence() {
    const targetBig = this.baseScale + 0.3;
    const targetSettle = this.baseScale + 0.2;

    await gsap.to(this.scale, {
      x: targetBig,
      y: targetBig,
      duration: 0.1,
      ease: "power1.out",
    });
    await gsap.to(this.scale, {
      x: targetSettle,
      y: targetSettle,
      duration: 0.15,
      ease: "power1.out",
    });
  }

  private resetScale() {
    gsap.to(this.scale, {
      x: this.baseScale,
      y: this.baseScale,
      duration: 0.2,
      ease: "power2.out",
    });
    gsap.to(this, { angle: 0, duration: 0.2, ease: "power2.out" }); // Also reset angle
  }

  // ========== UTILITY ==========

  public setBaseScale(scale: number): void {
    this.baseScale = scale;
    this.scale.set(scale);
  }

  public setHoverPadding(pixels: number) {
    this.hitArea = new Rectangle(
      -this.baseWidth / 2 - pixels,
      -this.baseHeight / 2 - pixels,
      this.baseWidth + pixels * 2,
      this.baseHeight + pixels * 2,
    );
  }
  public cardSize() {
    return { width: this.baseWidth, height: this.baseHeight };
  }

  private _greyscaleFilter: ColorMatrixFilter | null = null;

  private getGreyscaleFilter(): ColorMatrixFilter {
    if (!this._greyscaleFilter) {
      this._greyscaleFilter = new ColorMatrixFilter();
      this._greyscaleFilter.grayscale(0.35, false);
    }
    return this._greyscaleFilter;
  }

  public setGreyscale(enabled: boolean): void {
    if (enabled) {
      const filter = this.getGreyscaleFilter();
      if (this.spineCard) this.spineCard.filters = [filter];
      // Replace GlareFilter with greyscale on mesh (glare is inactive during betting)
      this.mesh.filters = [filter];
      this.shadow.filters = [filter];
    } else {
      if (this.spineCard) this.spineCard.filters = [];
      // Restore GlareFilter on mesh
      this.mesh.filters = [this.glareFilter];
      this.shadow.filters = [];
    }
  }

  // --- public getters ---
  public get rank(): string {
    return this._rank;
  }
  public get suit(): CardSuit {
    return this._suit;
  }
}
