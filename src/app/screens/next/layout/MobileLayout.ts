import { Container, Sprite } from "pixi.js";
import { GameLogic } from "../../../framework/GameLogic/GameLogic";
import { GameInformation } from "../../../framework/GameInformation/GameInformation";
import { BetBar } from "../../../framework/BetBar/BetBar";

export class MobileLayout extends Container {
  public fancyBoxContainer!: Container;
  public background!: Sprite;

  public gameLogic!: GameLogic;
  public gameInfo!: GameInformation;
  public betBar!: BetBar;

  constructor(width: number, height: number) {
    super();
    this.createLayout(width);
    this.resize(width, height, 0); // Initial resize check?
  }

  private createLayout(width: number) {
    this.fancyBoxContainer = new Container();
    this.addChild(this.fancyBoxContainer);

    this.background = Sprite.from("BG.png");
    this.background.anchor.set(0.5);
    this.background.tint = 0xC7C7C7;
    this.fancyBoxContainer.addChild(this.background);

    // --- Instantiate Framework Components ---
    this.gameLogic = new GameLogic();
    this.fancyBoxContainer.addChild(this.gameLogic);

    this.gameInfo = new GameInformation();
    this.fancyBoxContainer.addChild(this.gameInfo);

    this.betBar = new BetBar(width);
    this.fancyBoxContainer.addChild(this.betBar);
  }

  public get currentCard() { return this.gameLogic.currentCard; }
  public get inputBox() { return this.betBar.inputBox; }
  public get inputDefaultValue() { return this.betBar.inputDefaultValue; }
  public get upButton() { return this.gameLogic.upButton; }
  public get downButton() { return this.gameLogic.downButton; }
  public get fancySkipButton() { return this.gameLogic.fancySkipButton; }
  public get betButton() { return this.betBar.betButton; }
  public get halfValueButton() { return this.betBar.halfValueButton; }
  public get doubleValueButton() { return this.betBar.doubleValueButton; }
  public get highDes() { return this.gameLogic.highDes; }
  public get lowDes() { return this.gameLogic.lowDes; }
  public get highIcon() { return this.gameLogic.highIcon; }
  public get lowIcon() { return this.gameLogic.lowIcon; }
  public get titleHigh() { return this.gameLogic.titleHigh; }
  public get titleLow() { return this.gameLogic.titleLow; }
  public get multiplierBoard() { return this.gameLogic.multiplierBoard; }
  public get gameHistory() { return this.betBar.gameHistory; }
  public get cardHistoryLayout() { return this.gameLogic.cardHistoryLayout; }
  public get cardsContainer() { return this.gameLogic.cardsContainer; }

  // Proxy methods
  public updateMoney(value?: string) {
    this.betBar.updateMoney(value);
  }

  public animateFlyOff(rank: string, suit: any) {
    this.gameLogic.animateFlyOff(rank, suit);
  }

  public animateDeal() {
    this.gameLogic.animateDeal();
  }

  public resize(width: number, height: number, padding: number, verticalMargin: number = 0) {
    // Resize background to cover the full effective screen area
    if (this.background) {
      this.background.x = width / 2;
      this.background.y = height / 2;

      // Scale to cover (maintain aspect ratio)
      const scale = Math.max(width / this.background.texture.width, height / this.background.texture.height);
      this.background.scale.set(scale);
    }

    const bgTop = this.background ? this.background.y - this.background.height / 2 : 0;
    const bgBottom = this.background ? this.background.y + this.background.height / 2 : height;

    const screenTop = -verticalMargin;
    const screenBottom = height + verticalMargin;

    // --- Resize Delegate ---

    // 1. BetBar (Bottom - Anchor to Screen Bottom, Limit is Background)
    // We position the container itself at the clamped bottom. 
    // No internal offset needed since the container moves.
    this.betBar.resize(width, 0, padding, 0);
    this.betBar.y = Math.min(screenBottom, bgBottom);

    // 2. Game Logic (Top - Line up with Screen Top, Limit is Background)
    this.gameLogic.resize(width, height, padding);
    this.gameLogic.y = Math.max(screenTop, bgTop);

    // 3. Game Info (Top - Anchor to Screen Top)
    // Keeping this as requested for now (Previous behavior was -verticalMargin)
    // User said "game info - i will handle it later", so leaving current logic or safe default.
    // Preserving previous anchor for consistency unless explicitly broken.
    this.gameInfo.resize(width, height, padding, this.betBar.inputBox.y + this.betBar.y, this.betBar.inputBox.height);
    this.gameInfo.y = height / 2 + 9;

  }
}
