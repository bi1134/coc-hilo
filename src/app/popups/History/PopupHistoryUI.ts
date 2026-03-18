import { FancyButton } from "@pixi/ui";
import gsap from "gsap";
import { BitmapText, Container, NineSliceSprite, Sprite, Texture } from "pixi.js";
import { buttonAnimation } from "../../ui/ButtonAnimations";
import { PopupItemWrapper } from "./PopupItemWrapper";
import { TopHistoryUI } from "./TopHistoryUI";
import { engine } from "../../getEngine";

export class PopupHistoryUI extends Container {
  private closeBtn: FancyButton;
  private title: BitmapText;
  private bg: NineSliceSprite;
  /** The dark semi-transparent background covering current screen */
  private dimmer: Sprite;
  /** Container for the popup UI components */
  private panel: Container;

  private topHistoryUI: TopHistoryUI;

  private popupItemsWrapper: PopupItemWrapper;
  private targetTxId?: string;

  // Loading text
  private loadingText: BitmapText;

  // No history container
  private noHistoryContainer: Container;
  private crySprite: Sprite;
  private noHistoryText: BitmapText;

  public onHistoryPopupClosed?: () => void;

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
      text: "HISTORY",
      anchor: 0.5,
      style: {
        fontFamily: "coccm-bitmap-3-normal.fnt",
        fontSize: 20,
      },
    });
    this.title.position.set(
      this.bg.width / 2,
      this.title.height + this.title.height / 2,
    );

    this.closeBtn = new FancyButton({
      anchor: 0.5,
      defaultView: "exitButton.png",
      animations: buttonAnimation,
    });

    this.closeBtn.scale.set(1.75);
    this.closeBtn.onPress.connect(() => {
      engine().navigation.dismissPopup();
      this.onHistoryPopupClosed?.();
    });
    this.closeBtn.position.set(
      this.bg.width - this.closeBtn.width / 2 - 5,
      this.title.y + 10,
    );

    this.topHistoryUI = new TopHistoryUI();
    this.topHistoryUI.position.set(
      this.title.x,
      this.title.y + this.title.height * 2 + 5,
    );
    this.topHistoryUI.onDayOffsetChange = this.onDayOffsetChange.bind(this);

    const bgW = this.bg.width > 100 ? this.bg.width : 750;
    const bgH = this.bg.height > 100 ? this.bg.height : 1334;

    const startY = this.topHistoryUI.y + this.topHistoryUI.height + 10;
    const wrapperWidth = bgW - 50; // 25 px padding on each side
    const wrapperHeight = bgH - startY - 40;

    this.popupItemsWrapper = new PopupItemWrapper(wrapperWidth, wrapperHeight);
    this.popupItemsWrapper.onHistoryLoaded = this.onHistoryLoaded.bind(this);

    //#region Initial content
    this.popupItemsWrapper.position.set(
      (bgW - wrapperWidth) / 2,
      this.topHistoryUI.y + this.topHistoryUI.height + 10,
    );
    //#endregion

    //#region  No history cotainer
    this.crySprite = Sprite.from("king-cry-icon.png");
    this.noHistoryText = new BitmapText({
      text: "BELUM ADA TRANSAKSI",
      style: {
        fontFamily: "coccm-bitmap-3-normal.fnt",
        fontSize: 20,
        align: "center",
      },
    });
    this.crySprite.position.x =
      (this.noHistoryText.width - this.crySprite.width) / 2;
    this.noHistoryText.position.y =
      this.crySprite.height + this.noHistoryText.height * 2;

    this.noHistoryContainer = new Container();
    this.noHistoryContainer.addChild(this.crySprite, this.noHistoryText);
    this.noHistoryContainer.pivot.set(
      this.noHistoryContainer.width / 2,
      this.noHistoryContainer.height / 2,
    );
    this.noHistoryContainer.position.set(this.bg.width / 2, this.bg.height / 2);

    //#region Loading text
    this.loadingText = new BitmapText({
      text: "LOADING...",
      anchor: 0.5,
      style: {
        fontFamily: "coccm-bitmap-3-normal.fnt",
        fontSize: 23,
        align: "center",
      },
    });
    this.loadingText.position.set(this.bg.width / 2, this.bg.height / 2);
    this.updateLoadingTextVisible(false);
    //#endregion

    this.panel.addChild(
      this.bg,
      this.title,
      this.closeBtn,
      this.topHistoryUI,
      this.popupItemsWrapper,
      this.noHistoryContainer,
      this.loadingText,
    );

    // Pivot panel to center for scaling animations
    this.panel.pivot.set(this.bg.width / 2, this.bg.height / 2);

    this.visible = false;
  }

  private onHistoryLoaded(hasHistory: boolean) {
    // Disable loading text
    this.updateLoadingTextVisible(false);

    this.noHistoryContainer.visible = !hasHistory;
  }

  private updateLoadingTextVisible(visible: boolean) {
    this.loadingText.visible = visible;

    if (visible) {
      this.noHistoryContainer.visible = false;
    }
  }

  private onDayOffsetChange(dayOffset: number) {
    this.updateLoadingTextVisible(true);

    this.popupItemsWrapper.initItems(dayOffset);
  }

  public setTargetTxId(txId: string) {
    this.targetTxId = txId;
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
    this.updateLoadingTextVisible(true);

    const passedTxId = this.targetTxId;
    this.targetTxId = undefined;
    this.popupItemsWrapper.initItems(undefined, passedTxId);

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
      duration: 0.2,
      ease: "back.out",
    });
  }

  public async hide() {
    // Panel pop out
    await gsap.to(this.panel.scale, {
      x: 0.5,
      y: 0.5,
      duration: 0.2,
      ease: "back.in(1.7)",
    });

    gsap.to(this.panel, {
      alpha: 0,
      duration: 0.2,
    });

    // Dimmer fade out
    await gsap.to(this.dimmer, {
      alpha: 0,
      duration: 0.2,
    });

    this.visible = false;
    this.popupItemsWrapper.close();
    this.topHistoryUI.reset();
    this.updateLoadingTextVisible(false);
    this.noHistoryContainer.visible = false;
  }
}
