import { FancyButton } from "@pixi/ui";
import gsap from "gsap";
import { BitmapText, Container, NineSliceSprite, Sprite, Texture } from "pixi.js";
import { buttonAnimation } from "../ui/ButtonAnimations";
import { RulesWrapper } from "./Rules/RulesWrapper";
import { engine } from "../getEngine";

export class GameRulePopup extends Container {
    private closeBtn: FancyButton;
    private title: BitmapText;
    private bg: NineSliceSprite;
    /** The dark semi-transparent background covering current screen */
    private dimmer: Sprite;
    /** Container for the popup UI components */
    private panel: Container;

    private rulesWrapper: RulesWrapper;

    public onRulePopupClosed?: () => void;

    constructor() {
        super();

        // Initialize dimmer first so it's behind everything
        this.dimmer = new Sprite(Texture.WHITE);
        this.dimmer.tint = 0x000000;
        this.dimmer.alpha = 0;
        this.dimmer.interactive = true; // Blocks clicks behind
        this.addChild(this.dimmer);

        // All popup content goes into this panel for easier animation/centering
        this.panel = new Container();
        this.addChild(this.panel);

        this.bg = new NineSliceSprite({
            texture: Texture.from("bg-history-popup.png"),
            leftWidth: 60,
            topHeight: 80,
            rightWidth: 60,
            bottomHeight: 36,
        });
        this.bg.width = 750;
        this.bg.height = 1200;

        this.title = new BitmapText({
            text: "ATURAN MAIN",
            anchor: 0.5,
            style: {
                fontFamily: "coccm-bitmap-3-normal.fnt",
                fontSize: 30, // Slightly larger title
            },
        });
        this.title.position.set(
            this.bg.width / 2,
            this.title.height + 10,
        );

        this.closeBtn = new FancyButton({
            anchor: 0.5,
            defaultView: "exitButton.png",
            animations: buttonAnimation,
        });

        this.closeBtn.scale.set(1.75);
        this.closeBtn.onPress.connect(() => {
            engine().navigation.dismissPopup();
            this.onRulePopupClosed?.();
        });
        this.closeBtn.position.set(
            this.bg.width - this.closeBtn.width / 2 - 5,
            this.title.y,
        );

        // Calculate wrapper size
        const bgW = this.bg.width;
        const bgH = this.bg.height;

        const startY = this.title.y + this.title.height + 20;
        const wrapperWidth = bgW - 50; // 25 px padding on each side
        const wrapperHeight = bgH - startY - 40;

        this.rulesWrapper = new RulesWrapper(wrapperWidth, wrapperHeight);

        // Center it
        this.rulesWrapper.position.set(
            (bgW - wrapperWidth) / 2,
            startY
        );

        this.panel.addChild(
            this.bg,
            this.title,
            this.closeBtn,
            this.rulesWrapper
        );

        // Pivot panel to center for scaling animations
        this.panel.pivot.set(this.bg.width / 2, this.bg.height / 2);

        this.visible = false;
    }

    /** Resize the popup, fired whenever window size changes */
    public resize(width: number, height: number) {
        this.dimmer.width = width;
        this.dimmer.height = height;

        this.panel.x = width * 0.5;
        this.panel.y = height * 0.5;
    }

    public async show() {
        const { width, height } = engine().renderer.screen;
        // Calculate scale to fit 90% of screen width AND height, capped at 0.85
        const contentWidth = this.bg.width || 750;
        const contentHeight = this.bg.height || 1200;

        const scaleX = (width * 0.9) / contentWidth;
        const scaleY = (height * 0.9) / contentHeight;

        const targetScale = Math.min(0.85, scaleX, scaleY);

        this.visible = true;

        this.dimmer.alpha = 0;
        this.panel.scale.set(targetScale * 0.5); // Start at half the target size
        this.panel.alpha = 0;

        // Dimmer fade in
        gsap.to(this.dimmer, {
            alpha: 0.8,
            duration: 0.2,
            ease: "power2.out",
        });

        // Panel pop in
        await gsap.to(this.panel, {
            alpha: 1,
            duration: 0.1,
            ease: "power2.out",
        });

        await gsap.to(this.panel.scale, {
            x: targetScale,
            y: targetScale,
            duration: 0.15,
            ease: "back.out",
        });
    }

    public async hide() {
        // --- Panel "pop out" / shrink away ---
        await gsap.to(this.panel.scale, {
            x: 0.5,
            y: 0.5,
            duration: 0.15,
            ease: "back.in(1.7)",
        });

        // Parallel fade out
        gsap.to(this.panel, { alpha: 0, duration: 0.2 });

        // Fade out the background
        await gsap.to(this.dimmer, {
            alpha: 0,
            duration: 0.2,
        });

        this.visible = false;
    }
}
