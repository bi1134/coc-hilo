import { Container, BitmapText, Texture, NineSliceSprite } from "pixi.js";
import { gsap } from "gsap";
import { Spine } from "@esotericsoftware/spine-pixi-v8";

export enum AnimationState {
    Idle = "idle",
    Laugh = "laugh",
    Lose = "lose",
    Skip = "skip",
    Win = "win",
}

export class Character extends Container {
    private dialogBubble: NineSliceSprite;
    private character?: Spine;
    private dialogText: BitmapText;
    private comboInfoLabel: BitmapText;
    private comboPredictionLabel: BitmapText;
    private comboCurrentLabel: BitmapText;
    private dialogContainer: Container;

    constructor() {
        super();

        // Initialize containers first
        this.dialogContainer = new Container();

        // Assets are preloaded in NextScreen.ts
        // Create the Spine instance synchronously
        this.character = Spine.from({
            skeleton: "/spine-assets/hilo-character.skel",
            atlas: "/spine-assets/hilo-character.atlas",
        });

        this.addChild(this.character);
        this.addChild(this.dialogContainer); // Ensure dialog is on top

        // Log available animations for debugging
        if (this.character.skeleton && this.character.skeleton.data && this.character.skeleton.data.animations) {
            console.log("Character Animations:", this.character.skeleton.data.animations.map(a => a.name));
        }
        console.log("AnimationState Enum:", AnimationState);

        this.character.state.setAnimation(0, AnimationState.Idle, true);

        // Transform Settings
        this.character.x = 0;
        this.character.y = 0;
        this.character.scale.x = -1;

        // NineSlice Chat Bubble
        // Normal Dialog Bubble (NineSliceSprite now)
        this.dialogBubble = new NineSliceSprite({
            texture: Texture.from("Dialog-0.png"),
            leftWidth: 45,
            topHeight: 45,
            rightWidth: 45,
            bottomHeight: 45
        });
        this.dialogBubble.anchor.set(0.5, 1); // Bottom center
        this.dialogContainer.addChild(this.dialogBubble);

        // Label for text
        this.dialogText = new BitmapText({
            text: "",
            style: {
                fontFamily: "coccm-bitmap-3-normal",
                fontSize: 30,
                align: "center",
                wordWrap: true, // Need word wrap for chat bubble
                wordWrapWidth: 800,
                fill: "#fbca3f",
                lineHeight: 40
            }
        });
        this.dialogText.anchor.set(0.5, 0.5);
        // Text is centered in the bubble
        // Bubble anchor is (0.5, 1), so (0, -height/2) is center
        this.dialogContainer.addChild(this.dialogText);

        // --- Combo UI Elements --
        // 1. Info Label ("x more High to receive")
        this.comboInfoLabel = new BitmapText({
            text: "",
            style: {
                fontFamily: "SVN-Supercell Magic",
                fontSize: 17,
                align: "left",
                fill: "#327ac4", // White for Supercell
                wordWrap: true,
                wordWrapWidth: 300
            }
        });
        this.comboInfoLabel.anchor.set(0.5, 0.5);
        this.comboInfoLabel.position.set(50, -80); // Top
        this.dialogContainer.addChild(this.comboInfoLabel);

        // 2. Prediction Label ("15.5x") - Prominent
        this.comboPredictionLabel = new BitmapText({
            text: "",
            style: {
                fontFamily: "coccm-bitmap-3-normal",
                fontSize: 19, // Larger
                align: "center",
                fill: "#fbca3f", // Yellow
            }
        });
        this.comboPredictionLabel.anchor.set(0.5, 0.5);
        this.comboPredictionLabel.position.set(0, -60); // Middle
        this.dialogContainer.addChild(this.comboPredictionLabel);

        // 3. Current Label ("Current: 1.2x")
        this.comboCurrentLabel = new BitmapText({
            text: "",
            style: {
                fontFamily: "coccm-bitmap-3-normal",
                fontSize: 30,
                align: "center",
                fill: "#fbca3f", //yellow
            }
        });
        this.comboCurrentLabel.anchor.set(0.5, 0.5);
        this.comboCurrentLabel.position.set(0, -25); // Bottom
        this.dialogContainer.addChild(this.comboCurrentLabel);

        // Hide initially
        this.comboInfoLabel.visible = false;
        this.comboPredictionLabel.visible = false;
        this.comboCurrentLabel.visible = false;

        // Position Dialog Container
        const padding = 10;
        this.dialogContainer.x = this.character.x - this.character.width;
        this.dialogContainer.y = this.character.y - this.character.height / 2 + padding * 2;

        // Initial Dialog
        this.say("Press Bet \n to Start");
    }

    public say(mainText: string, type: 'normal' | 'combo' = 'normal', subText: string = "", extraText: string = "") {
        gsap.killTweensOf(this.dialogContainer);
        gsap.killTweensOf(this.dialogContainer.scale);

        if (!mainText) {
            gsap.to(this.dialogContainer.scale, {
                x: 0.75,
                y: 0.75,
                duration: 0.4,
                ease: "back.in",
                onComplete: () => {
                    this.dialogContainer.visible = false;
                }
            });
            return;
        }

        const refTexture = Texture.from("Dialog.png");
        const normalTexture = Texture.from("Dialog-0.png");
        const comboTexture = Texture.from("Dialog_1.png");

        if (type === 'combo') {
            this.dialogBubble.texture = comboTexture;

            // Match size of normal (Ref) dialog and flip
            // Using width/height prevents 9-slice stretching
            // refTexture.width/height gives the original dimensions of Dialog.png

            // Adjust these multipliers if you want it larger/smaller
            const targetW = refTexture.width;
            const targetH = refTexture.height;

            this.dialogBubble.width = targetW;
            this.dialogBubble.height = targetH;

            // Just flip, don't scale size
            this.dialogBubble.scale.set(-1, 1);

            // Show Combo Labels, Hide Normal Text
            this.comboInfoLabel.visible = true;
            this.comboPredictionLabel.visible = true;
            this.comboCurrentLabel.visible = true;
            this.dialogText.visible = false;

            this.comboInfoLabel.text = mainText; // "x more High to receive"
            this.comboPredictionLabel.text = subText; // "15x"
            this.comboCurrentLabel.text = extraText; // "Current: 1.0x"

            // Layout Logic: Align Info and Prediction on same line
            const spacing = 5;
            const yPos = -85; // Middle-ish

            // Ensure text is updated before measuring
            // this.comboInfoLabel.updateText(true);
            // this.comboPredictionLabel.updateText(true);

            const w1 = this.comboInfoLabel.width;
            const w2 = this.comboPredictionLabel.width;
            const totalW = w1 + w2 + spacing;

            // Start X to center the group
            const startX = -totalW / 2 - 5;

            // Set positions
            // Left Item Center = StartX + (w1 / 2)
            this.comboInfoLabel.position.set(startX + (w1 / 2), yPos);

            // Right Item Center = StartX + w1 + spacing + (w2 / 2)
            this.comboPredictionLabel.position.set(startX + w1 + spacing + (w2 / 2), yPos - 2);

            // Current Label stays at bottom
            this.comboCurrentLabel.position.set(0, -35);

        } else {
            this.dialogBubble.texture = normalTexture;
            this.dialogBubble.scale.set(-1, 1);

            // Show Normal Text, Hide Combo Labels
            this.comboInfoLabel.visible = false;
            this.comboPredictionLabel.visible = false;
            this.comboCurrentLabel.visible = false;
            this.dialogText.visible = true;

            this.dialogText.text = mainText;
        }

        // --- Normal Dialog Logic ---
        this.dialogContainer.visible = true;

        if (type !== 'combo') {
            // Measure text
            this.dialogText.scale.set(1);

            // Reset text settings that might have been tweaked
            this.dialogText.scale.set(1);
            this.dialogText.style.wordWrapWidth = 300; // A reasonable default max width
            this.dialogText.text = mainText;

            // Fixed size matching combo logic (User request)
            const targetW = refTexture.width;
            const targetH = refTexture.height;

            this.dialogBubble.width = targetW;
            this.dialogBubble.height = targetH;

            // Ensure flipped
            this.dialogBubble.scale.set(-1, 1);

            this.dialogText.position.set(0, -targetH / 2); // slightly up for visual balance
        }

        // Animate In
        this.dialogContainer.scale.set(0);
        gsap.to(this.dialogContainer.scale, {
            x: 1.1,
            y: 1.1,
            duration: 0.2,
            ease: "back.out(1.7)",
        });
    }
    public playState(state: 'win' | 'lose' | 'skip') {
        if (!this.character) return;

        let animName = AnimationState.Idle;

        switch (state) {
            case 'win':
                animName = AnimationState.Win;
                break;
            case 'lose':
                animName = AnimationState.Lose;
                break;
            case 'skip':
                animName = AnimationState.Skip; // Assuming you have a Skip animation, or maybe use flip? user said "skip then skip state"
                break;
        }

        // Play specific animation once, then queue idle loop
        this.character.state.setAnimation(0, animName, false);
        this.character.state.addAnimation(0, AnimationState.Idle, true, 0);
    }
}
