import { Container, Sprite, Text, TextStyleOptions } from "pixi.js";
import { Signal } from "typed-signals";
import { BitmapLabel } from "../ui/BitmapLabel";

export class BetInput extends Container {
    public bg: Sprite;
    public displayText: BitmapLabel | Text;
    public onPress: Signal<(e?: any) => void> = new Signal();
    public onChange: Signal<(value: string) => void> = new Signal();

    private _value: string = "";

    public get value(): string {
        return this._value;
    }
    public set value(v: string) {
        this._value = v;
        this.updateText();
        this.onChange.emit(v);
    }

    public set interactive(v: boolean) {
        this.eventMode = v ? 'static' : 'none';
        this.cursor = v ? 'pointer' : 'default';
    }

    private _textLimitRatio: number = 0.9;
    private _offsetX: number = 0;
    private _offsetY: number = 0;

    constructor(options: {
        bg: Sprite;
        fontSize?: number;
        fontFamily?: string;
        placeholder?: string;
        align?: "left" | "center" | "right";
        textColor?: number; // Tint for display text
        padding?: number;
        textLimitRatio?: number; // Ratio of bg width to limit text before scaling
        style?: TextStyleOptions; // New style support
        offsetX?: number; // Horizontal offset for text
        offsetY?: number; // Vertical offset for text
    }) {
        super();

        this.bg = options.bg;
        // Resetting anchor to 0 to match likely previous behavior if 'bg' was sprite default.
        this.bg.anchor.set(0);
        this.addChild(this.bg);

        if (options.textLimitRatio !== undefined) {
            this._textLimitRatio = options.textLimitRatio;
        }
        if (options.offsetX !== undefined) {
            this._offsetX = options.offsetX;
        }
        if (options.offsetY !== undefined) {
            this._offsetY = options.offsetY;
        }

        if (options.style) {
            // Use Text for rich styling
            this.displayText = new Text({
                text: "",
                style: options.style
            });
            // Apply textColor override if provided and not in style?
            // Usually style.fill takes precedence.
            if (options.textColor !== undefined && !options.style.fill) {
                this.displayText.style.fill = options.textColor;
            }
        } else {
            // 2. Create BitmapLabel for display (Legacy)
            this.displayText = new BitmapLabel({
                text: "",
                style: {
                    fontFamily: options.fontFamily || "coccm-bitmap-3-normal",
                    fontSize: options.fontSize || 30,
                    align: options.align || "center",
                    tint: options.textColor || 0xffffff,
                    letterSpacing: -2,
                },
            });
        }

        this.displayText.anchor.set(0.5);
        this.addChild(this.displayText);

        // Usage as button
        this.interactive = true;
        this.on("pointertap", () => {
            this.onPress.emit();
        });

        // Initial sync
        this.value = options.placeholder || "0";

        // Initial text positioning (before resize is called)
        this.displayText.x = this.bg.width / 2 + this._offsetX;
        this.displayText.y = this.bg.height / 2 + this._offsetY;
    }

    private updateText() {
        const numValue = parseFloat(this._value.replace(/,/g, ''));
        if (!isNaN(numValue)) {
            const formatted = numValue.toLocaleString('en-US', {
                minimumFractionDigits: 0,
                maximumFractionDigits: 2,
            });
            this.displayText.text = "RP " + formatted;
        } else {
            this.displayText.text = "RP " + this._value;
        }

        // Reset scale to measure natural width
        this.displayText.scale.set(1);

        const maxWidth = this.bg.width * this._textLimitRatio; // Use configured ratio
        if (this.displayText.width > maxWidth) {
            const scale = maxWidth / this.displayText.width;
            this.displayText.scale.set(scale);
        }
    }

    public resize(width: number, height: number) {
        // Resize background directly
        this.bg.width = width;
        this.bg.height = height;

        // Center Display Text
        // Since bg is anchor 0.5 and added to container, and container might be positioned by center...
        // Let's assume (0,0) is center if bg is centered.
        // Wait, in previous code resize set bg.width/height but didn't touch anchor.
        // I set bg.anchor to 0.5 in constructor above.

        // If container interactions are expected from top-left, we should align bg to top-left or keep it centered.
        // In BetBar: this.inputBox.pivot.set(this.inputBox.width / 2, this.inputBox.height / 2);
        // This suggests the parent expects to pivot it.

        // Let's keep (0,0) as center for simplicity of "button-like" behavior if possible, 
        // OR adhere to previous standard where children were added at 0,0 (top-left).

        // Resetting anchor to 0 to match likely previous behavior if 'bg' was sprite default.
        this.bg.anchor.set(0);
        this.bg.x = 0;
        this.bg.y = 0;

        this.displayText.x = width / 2 + this._offsetX;
        this.displayText.y = height / 2 + this._offsetY;
    }
}

