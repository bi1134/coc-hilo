import { Switcher, FancyButton } from "@pixi/ui";
import { gsap } from "gsap";
import { ColorMatrixFilter, Container, Sprite, Texture } from "pixi.js";
import { engine } from "../getEngine";
import {
  CustomSettingSwitcher,
  CustomSwitcherType,
} from "./CustomSettingSwitcher";
import { LayoutHelper } from "../utils/LayoutHelper";
import { UI } from "./Manager/UIManager";

export class SettingsUI extends Container {
  private settingsSwitcher: Switcher;
  private settingsIcon: Sprite;
  private questionMark: CustomSettingSwitcher;
  private historyIcon: CustomSettingSwitcher;
  private audio: CustomSettingSwitcher;
  public bgSetting: Sprite;
  private invisCloseButton: FancyButton;
  private dimOverlay: Sprite;


  constructor() {
    super();

    this.sortableChildren = true;

    // Background
    this.bgSetting = Sprite.from("bg-setting.png");
    this.bgSetting.anchor.set(0.5);

    this.bgSetting.zIndex = -1;
    this.bgSetting.visible = false;

    // Main switcher button
    this.settingsSwitcher = new Switcher([
      "Button-0-2.png",
      "Button-0-0.png",
    ]);
    this.settingsSwitcher.onChange.connect((state) => {
      this.updateVisibleUI(state);
    });

    this.settingsIcon = Sprite.from("icon-setting.png");
    this.settingsIcon.anchor.set(0.5);
    this.settingsIcon.scale.set(1.1);
    this.settingsIcon.position.set(
      this.settingsSwitcher.x + this.settingsSwitcher.width / 2,
      this.settingsSwitcher.y + this.settingsSwitcher.height / 2 - 15,
    );

    this.settingsSwitcher.addChild(this.settingsIcon);
    // History Icon
    this.historyIcon = new CustomSettingSwitcher({
      views: ["history.png", "history.png"],
      type: CustomSwitcherType.HISTORY,
    });
    this.historyIcon.visible = false;
    this.historyIcon.onChange.connect(() => {
      this.settingsSwitcher.switch(0);
      UI.showHistory();
    });

    // Audio Icon
    this.audio = new CustomSettingSwitcher({
      views: ["audio_on.png", "audio_off.png"],
      type: CustomSwitcherType.SOUND,
    });

    this.audio.visible = false;
    this.audio.onChange.connect((state) => {
      if (state) {
        engine().audio.setMasterVolume(0);
      } else {
        engine().audio.setMasterVolume(0.5);
      }
    });

    // Question Icon
    this.questionMark = new CustomSettingSwitcher({
      views: ["question_mark.png", "question_mark.png"],
      type: CustomSwitcherType.HELP,
    });
    this.questionMark.visible = false;
    this.questionMark.onChange.connect(() => {
      UI.showGameRule();
    });

    this.dimOverlay = new Sprite(Texture.WHITE);
    this.dimOverlay.tint = 0x000000;
    this.dimOverlay.alpha = 0;
    this.dimOverlay.visible = false;
    this.dimOverlay.zIndex = -3; // below icons and bgSetting

    this.invisCloseButton = new FancyButton({
      defaultView: "rounded-rectangle.png",
      anchor: 0.5,
      width: 1,
      height: 1,
    });
    this.invisCloseButton.alpha = 0;
    this.invisCloseButton.visible = false;
    this.invisCloseButton.zIndex = -2; // above overlay but below icons
    this.invisCloseButton.onPress.connect(() => {
      if (this.settingsSwitcher.active === 1) {
        this.settingsSwitcher.switch(0);
      }
    });

    this.addChild(
      this.dimOverlay,
      this.invisCloseButton,
      this.bgSetting,
      this.historyIcon,
      this.audio,
      this.questionMark,
      this.settingsSwitcher,
    );

    // Initial layout
    this.resize(this.width, this.height);
  }

  /** Sizes the overlay and close button to cover the full screen,
   *  accounting for this container's parent scale via worldTransform. */
  private resizeOverlayToScreen() {
    const { width: sw, height: sh } = engine().screen;
    const wt = this.worldTransform;
    // wt.a/d = accumulated scale X/Y, wt.tx/ty = screen-space origin of this container
    const scaleX = Math.abs(wt.a) || 1;
    const scaleY = Math.abs(wt.d) || 1;
    const localW = sw / scaleX;
    const localH = sh / scaleY;
    const localOriginX = -wt.tx / scaleX;
    const localOriginY = -wt.ty / scaleY;

    this.dimOverlay.x = localOriginX;
    this.dimOverlay.y = localOriginY;
    this.dimOverlay.width = localW;
    this.dimOverlay.height = localH;

    this.invisCloseButton.setSize(localW, localH);
    this.invisCloseButton.x = localOriginX + localW / 2;
    this.invisCloseButton.y = localOriginY + localH / 2;
  }

  public resize(_width: number, _height: number) {
    const padding = 10;

    LayoutHelper.centerX(this.bgSetting, this.settingsSwitcher.width, 0, false);
    LayoutHelper.setPositionY(
      this.bgSetting,
      this.settingsSwitcher.y - this.bgSetting.height / 2 - padding * 18,
    );

    const backgroundCenter = this.bgSetting.x;

    LayoutHelper.setPositionX(this.historyIcon, backgroundCenter);
    LayoutHelper.setPositionX(this.audio, backgroundCenter);
    LayoutHelper.setPositionX(this.questionMark, backgroundCenter);

    LayoutHelper.setPositionY(this.audio, this.bgSetting.y - padding);
    LayoutHelper.setPositionY(
      this.historyIcon,
      this.audio.y - this.audio.height * 2 - padding,
    );
    LayoutHelper.setPositionY(
      this.questionMark,
      this.audio.y + this.audio.height * 2 + padding,
    );

    // Overlay/button are inside SettingsUI — no special positioning needed here;
    // resizeOverlayToScreen() is called when they become visible.
  }

  public updateUI(isBetting: boolean) {
    if (!isBetting) {
      // In-game: Disable history button and make it grayscale
      const color = new ColorMatrixFilter();
      color.grayscale(0.35, false);

      this.historyIcon.filters = [color];
      this.historyIcon.interactiveChildren = false;
      this.historyIcon.alpha = 1;
    } else {
      // Betting time: Re-enable
      this.historyIcon.filters = [];
      this.historyIcon.interactiveChildren = true;
      this.historyIcon.alpha = 1;
    }
  }

  private updateVisibleUI(state: number | boolean) {
    if (state) {
      this.resizeOverlayToScreen(); // Compute correct screen-covering size before showing
      this.dimOverlay.visible = true;
      this.invisCloseButton.visible = true;
      gsap.to(this.dimOverlay, { alpha: 0.6, duration: 0.2 });

      gsap.to(this.bgSetting, {
        duration: 0.1,
        ease: "back.out",
        scale: 2,
        onStart: () => {
          this.bgSetting.visible = true;
        },
      });

      gsap.to(this.audio, {
        duration: 0.1,
        ease: "back.out",
        scale: 2,
        onStart: () => {
          this.audio.visible = true;
        },
      });
      gsap.to(this.historyIcon, {
        duration: 0.1,
        ease: "back.out",
        scale: 2,
        onStart: () => {
          this.historyIcon.visible = true;
        },
      });
      gsap.to(this.questionMark, {
        duration: 0.1,
        ease: "back.out",
        scale: 2,
        onStart: () => {
          this.questionMark.visible = true;
        },
      });
    } else {
      this.invisCloseButton.visible = false;
      gsap.to(this.dimOverlay, { alpha: 0, duration: 0.15, onComplete: () => { this.dimOverlay.visible = false; } });

      gsap.to(this.bgSetting, {
        duration: 0.1,
        ease: "back.in",
        scale: 0.75,
        onStart: () => {
          this.bgSetting.visible = false;
        },
      });

      gsap.to(this.audio, {
        duration: 0.1,
        ease: "back.in",
        scale: 0.75,
        onStart: () => {
          this.audio.visible = false;
        },
      });
      gsap.to(this.historyIcon, {
        duration: 0.1,
        ease: "back.in",
        scale: 0.75,
        onStart: () => {
          this.historyIcon.visible = false;
        },
      });
      gsap.to(this.questionMark, {
        duration: 0.1,
        ease: "back.in",
        scale: 0.75,
        onStart: () => {
          this.questionMark.visible = false;
        },
      });
    }
  }
}
