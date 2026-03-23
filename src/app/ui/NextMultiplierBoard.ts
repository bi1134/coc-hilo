import { Container, Sprite, BitmapText } from "pixi.js";
import { Spine } from "@esotericsoftware/spine-pixi-v8";
import { gsap } from "gsap";
import { NumberAnimator } from "../utils/NumberAnimator";

export enum UIInfoAnimationState {
    Idle = "idle",
    action = "action",
    action1 = "action1",
}

export class NextMultiplierBoard extends Container {
    private bg: Sprite;
    private topLabel: BitmapText;
    private bottomLabel: BitmapText;
    private infoSpine?: Spine;
    private currentTotalWin: number = 0;
    private currentTween: gsap.core.Tween | null = null;

    constructor() {
        super();

        this.sortableChildren = true;

        // Background
        this.bg = Sprite.from("Bar-info.png");
        this.bg.anchor.set(0.5);
        this.bg.zIndex = 0;
        this.addChild(this.bg);
        this.bg.visible = false;

        // Initialize Spine synchronously (Assets are preloaded in NextScreen.ts)
        this.infoSpine = Spine.from({
            skeleton: "/spine-assets/UI_Info.skel",
            atlas: "/spine-assets/UI_Info.atlas",
        });

        // Log available animations for debugging
        console.log("UI Info Animations:", this.infoSpine.skeleton.data.animations.map(a => a.name));

        this.infoSpine.state.setAnimation(0, UIInfoAnimationState.Idle, true);
        this.infoSpine.zIndex = 1;
        this.addChild(this.infoSpine);
        this.infoSpine.height = 180;
        // Position
        this.infoSpine.x = 0; // Relative to this container
        this.infoSpine.y = 0;

        // Top Label "Next Win"
        this.topLabel = new BitmapText({
            text: "Multiplier",
            style: {
                fontFamily: "coccm-bitmap-3-normal",
                fontSize: 30, // Estimated size
                align: "center",
            }
        });
        this.topLabel.anchor.set(0.5);
        this.topLabel.position.set(0, this.bg.y); // Upper half
        this.topLabel.tint = 0xd6c6c6; // Slightly dim or white
        this.topLabel.zIndex = 2;
        //this.addChild(this.topLabel);

        // Bottom Label - starts at 0 before any wins
        this.bottomLabel = new BitmapText({
            text: "0",
            style: {
                fontFamily: "coccm-bitmap-3-normal",
                fontSize: 35, // Larger
                align: "center",
                fill: "#ffffffff" // Gold-ish
            }
        });
        this.bottomLabel.anchor.set(0.5);
        this.bottomLabel.position.set(0, this.bg.y); // Lower half
        this.bottomLabel.zIndex = 2;
        this.addChild(this.bottomLabel);
    }

    public setMultiplier(value: number) {
        // Deprecated or fallback
        this.updateValues(value, 0);
    }

    public updateValues(multiplier: number, currentBet: number, skipSpine: boolean = false) {
        const totalWin = multiplier * currentBet;

        if (this.currentTween) {
            this.currentTween.kill();
            this.currentTween = null;
        }

        if (totalWin > 0) {
            this.currentTween = NumberAnimator.animate(
                this.bottomLabel as any,
                this.currentTotalWin,
                totalWin,
                0.5, // Quick 0.5s roll up
                "RP ",
                "",
                2
            );
        } else {
            this.bottomLabel.text = "RP 0";
        }

        this.currentTotalWin = totalWin;

        if (!skipSpine && this.infoSpine) {
            this.infoSpine.state.setAnimation(0, UIInfoAnimationState.action, false);
            this.infoSpine.state.addAnimation(0, UIInfoAnimationState.Idle, true, 0);
        }
    }

    public playWinAnimation() {
        if (this.infoSpine) {
            this.infoSpine.state.setAnimation(0, UIInfoAnimationState.action1, false);
            this.infoSpine.state.addAnimation(0, UIInfoAnimationState.Idle, true, 0);
        }
    }

    /**
     * Override getLocalBounds to return only the background bounds.
     * This prevents the spine animation from affecting the container's layout size.
     */
    public override getLocalBounds(): import("pixi.js").Bounds {
        return this.bg.getLocalBounds();
    }
}
