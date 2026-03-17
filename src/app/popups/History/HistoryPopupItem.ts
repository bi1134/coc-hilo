import { FancyButton, Switcher, ScrollBox } from "@pixi/ui";
import { BitmapText, Container, Graphics, Sprite } from "pixi.js";
import { buttonAnimation } from "../../ui/ButtonAnimations";
import { CardHistoryItem } from "../../ui/CardHistoryItem";
import { GameService } from "../../api/services/GameService"; // Import Service
import { GuessAction } from "../../screens/next/types/GameTypes";

// --- Constants ---
const CARD_SCALE = 0.3; // Reduced scale as requested
const CARD_GAP = 15;    // Adjusted gap

// --- Mock / Stub Types ---
interface HistoryResponseData {
  bet_id: string;
  amount: number;
  timestamp: string; // ISO string format
  multiplier: number;
  total_win: number;
  status: string;
  debitAmount?: number;
  creditAmount?: number;
  game_info?: any;
  history_cards: {
    card: string;
    guess: 'l' | 'h';
  }[];
}

interface HistoryDetailApiResponse {
  data: any;
}

// --- Helper ---
function formatNumber(num: number): string {
  if (num === null || num === undefined || isNaN(num)) return "0";
  return num.toLocaleString('en-US');
}

export type ItemHisotyPopupOptions = {
  betAmount: number;
  dateTime: string;
  profit: number;
  multiplier: number;
};

export class HisotryPopupItem extends Container {
  private readonly OFFSET = 10;

  private readonly FONT_SIZE = 17;

  // Layout Constants
  private itemWidth: number;
  private readonly ITEM_HEIGHT = 80;

  private bg: Graphics;

  // Top ui
  private bgItem: Container; // Changed from Sprite to Container to support Graphics fallback
  private betAmount: BitmapText;
  private dateTimeText: BitmapText;
  private profitText: BitmapText;
  private multiplier: BitmapText;
  private expandSwitcher: Switcher;

  // Inner UI

  private innerWrapper: Container;
  private textWrapper: Container;
  private idText: BitmapText;
  private copyIdButton: FancyButton;
  private betId: BitmapText;
  private board: ScrollBox;

  private loadingText: BitmapText;

  public onItemVisibleChange?: (state: boolean) => void;

  constructor(width: number = 600) {
    super();

    this.itemWidth = width;

    this.sortableChildren = true;

    // Use Graphics for background to ensure visibility/size
    this.bgItem = new Graphics()
      .roundRect(0, 0, this.itemWidth, this.ITEM_HEIGHT, 15)
      .fill({ color: 0x2A2E37 }); // Dark grey bg

    this.betAmount = new BitmapText({
      text: "Taruhan: 2,000",
      anchor: { x: 0, y: 0.5 }, // Only center vertically
      style: {
        fontSize: this.FONT_SIZE,
        fontFamily: "coccm-bitmap-3-normal.fnt",
        align: "left",
      },
    });
    this.betAmount.position.set(this.OFFSET, this.ITEM_HEIGHT * 0.3);

    this.dateTimeText = new BitmapText({
      text: "12/02/2025, 10:55",
      anchor: { x: 0, y: 0.5 },
      style: {
        fontFamily: "coccm-bitmap-3-normal.fnt",
        fontSize: this.FONT_SIZE,
        fill: "#76859F",
        align: "left",
      },
    });
    this.dateTimeText.position.set(
      this.OFFSET,
      this.ITEM_HEIGHT / 2 + this.betAmount.height / 2 + 5,
    );

    this.profitText = new BitmapText({
      text: "RP 3,800",
      anchor: { x: 1, y: 0.5 }, // Right align
      style: {
        fontSize: this.FONT_SIZE,
        fontFamily: "coccm-bitmap-3-normal.fnt",
        fill: "#5FFF44",
        align: "right",
      },
    });

    this.multiplier = new BitmapText({
      text: "Mult.1,000.00x",
      anchor: { x: 1, y: 0.5 }, // Right align
      style: {
        fontSize: this.FONT_SIZE,
        fontFamily: "coccm-bitmap-3-normal.fnt",
        fill: "#76859F",
        align: "right",
      },
    });

    const sprite = Sprite.from("expand-button.png");
    sprite.anchor = 0.5;
    const collapseSprite = Sprite.from("expand-button.png");
    collapseSprite.scale.y = -1;
    collapseSprite.anchor = 0.5;
    this.expandSwitcher = new Switcher([sprite, collapseSprite]);

    // Position switcher based on FIXED width
    this.expandSwitcher.position.set(
      this.itemWidth - this.expandSwitcher.width / 2 - this.OFFSET,
      this.ITEM_HEIGHT / 2,
    );
    this.expandSwitcher.onChange.connect(
      this.onExpandSwitcherChange.bind(this),
    );

    this.profitText.position.set(
      this.expandSwitcher.x - this.expandSwitcher.width / 2 - this.OFFSET,
      this.betAmount.y,
    );

    this.multiplier.position.set(
      this.expandSwitcher.x - this.expandSwitcher.width / 2 - this.OFFSET,
      this.dateTimeText.y,
    );

    // Inner UI
    this.idText = new BitmapText({
      text: "Bet ID: ",
      anchor: { x: 0, y: 0 },
      style: {
        fontSize: 20,
        fontFamily: "coccm-bitmap-3-normal.fnt",
        align: "center",
        letterSpacing: -1,
      },
    });
    this.betId = new BitmapText({
      text: "692e5fec4020c1ac83069397",
      anchor: { x: 0, y: 0 },
      style: {
        fontSize: 20,
        fontFamily: "coccm-bitmap-3-normal.fnt",
        align: "center",
        fill: "#4CADFE",
        letterSpacing: -1,
      },
    });
    this.betId.x = this.idText.x + this.idText.width + 10;
    this.copyIdButton = new FancyButton({
      defaultView: "copy-icon.png",
      animations: buttonAnimation,
    });
    this.copyIdButton.x = this.betId.x + this.betId.width + 15;
    this.copyIdButton.onPress.connect(async () => {
      const betIdText = this.betId.text;

      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(betIdText);
        } else {
          // Fallback for browsers that don't support clipboard API
          const textarea = document.createElement("textarea");
          textarea.value = betIdText;
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand("copy");
          document.body.removeChild(textarea);
        }
      } catch (err) {
        console.error("Copy failed:", err);
      }
    });

    this.textWrapper = new Container();
    this.textWrapper.addChild(this.idText, this.betId, this.copyIdButton);
    this.textWrapper.pivot.set(this.textWrapper.width / 2, 0);
    this.textWrapper.position.set(this.itemWidth / 2, this.OFFSET);

    this.board = new ScrollBox({
      type: 'horizontal',
      width: this.itemWidth - this.OFFSET * 2,
      height: 170, // Approx height for cards
      elementsMargin: CARD_GAP,
      padding: 20,
      background: 0x000000,
    });
    this.initBoard();

    this.bg = new Graphics()
      .roundRect(0, 0, this.itemWidth, 570)
      .fill({ color: "#535C6D" });
    this.bg.zIndex = -1;

    this.loadingText = new BitmapText({
      text: "LOADING...",
      anchor: 0.5,
      style: {
        fontFamily: "coccm-bitmap-3-normal.fnt",
        fontSize: 20,
        align: "center",
      },
    });

    this.loadingText.position.set(this.bg.width / 2, this.bg.height / 2);

    this.innerWrapper = new Container();
    this.innerWrapper.addChild(this.textWrapper, this.board, this.loadingText);

    // Center pivot based on the known content width
    this.innerWrapper.pivot.set(this.itemWidth / 2, 0);

    this.innerWrapper.scale = 0.75;

    this.innerWrapper.position.set(
      this.itemWidth / 2,
      this.ITEM_HEIGHT + 15,
    );

    this.addChild(
      this.bg,
      this.bgItem,
      this.betAmount,
      this.dateTimeText,
      this.profitText,
      this.multiplier,
      this.expandSwitcher,
      this.innerWrapper,
    );

    // Turn off visible for the first time
    this.bg.visible = false;
    this.innerWrapper.visible = false;
  }

  private initBoard() {
    // ScrollBox clean up
    if ((this.board as any).removeItems) {
      (this.board as any).removeItems();
    } else {
      this.board.removeChildren();
    }

    // Position the board container
    // We will populate it dynamically in setBoard
    this.board.position.set(
      this.OFFSET - 10,
      this.betId.y + this.betId.height + this.OFFSET * 4
    );
  }

  public setHistoryDetailData(response: HistoryResponseData) {
    // Bet id
    this.betId.text = response.bet_id;

    // Bet amount
    const betAmount = response.debitAmount || response.amount || response.game_info?.minigames?.amount || 0;
    this.betAmount.text = `Taruhan: ${formatNumber(betAmount)}`;

    // Date time
    const dateTime = response.timestamp;
    const date = new Date(dateTime);

    const formatted = new Intl.DateTimeFormat("en-US", {
      month: "2-digit",
      day: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);

    this.dateTimeText.text = formatted;

    // Profit text
    const sign = response.multiplier === 0 ? "-" : "";
    const profitNumber = response.multiplier === 0 ? betAmount :
      (response.creditAmount || response.total_win || response.game_info?.minigames?.total_win || 0);

    console.log("Profit Number", profitNumber);
    this.profitText.text = `${sign}RP ${formatNumber(profitNumber)}`;

    // Check status to fill color
    if (response.multiplier !== 0) this.profitText.style.fill = "#5FFF44";
    else this.profitText.style.fill = "#FFDE45";

    // Multiplier
    const muliplier = response.game_info?.minigames?.multiplier || response.multiplier || 0;
    this.multiplier.text = `Mult.${formatNumber(muliplier)}x`;
  }

  private setBoard(response: HistoryDetailApiResponse | null) {
    // Clear items first
    if ((this.board as any).removeItems) {
      (this.board as any).removeItems();
    }

    if (!response || !response.data || !response.data[0]) return;

    const info = response.data[0].game_info.minigames;
    // Parse history_cards string list: e.g. "n-1-5-0.00"
    // Format: status-suit-rank-multiplier

    if (info.history_cards && Array.isArray(info.history_cards)) {
      let currentX = 0;
      info.history_cards.forEach((cardStr: string, index: number) => {
        const parts = cardStr.split('-');
        if (parts.length >= 4) {
          const statusKey = parts[0]; // n, s, h, l
          const suit = parseInt(parts[1]);
          const rankStr = parts[2];
          const mult = parseFloat(parts[3]);

          // Convert rank numeric to string char if needed (CardHistoryItem expectation)
          const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
          const rankIndex = parseInt(rankStr) - 1;
          const rankChar = (rankIndex >= 0 && rankIndex < ranks.length) ? ranks[rankIndex] : rankStr;

          let guessAction: GuessAction = GuessAction.Start;
          // Map statusKey to action string ENUM
          if (statusKey === 'l') guessAction = GuessAction.Lower;
          else if (statusKey === 'h') guessAction = GuessAction.Higher;
          else if (statusKey === 's') guessAction = GuessAction.Skip;
          else if (statusKey === 'n') guessAction = GuessAction.Start;

          // Determine if this specific card was the losing card
          // A card is red ONLY if the overall round was a loss AND it's the very last card
          const isLosingCard = (response.data[0].status === "lose" && index === info.history_cards.length - 1);
          const isWin = !isLosingCard;

          // Map numeric suit to string suit string for CardHistoryItem/Texture
          let suitStr = "spade";
          switch (suit) {
            case 1: suitStr = "diamond"; break;
            case 2: suitStr = "club"; break;
            case 3: suitStr = "heart"; break;
            case 4: suitStr = "spade"; break;
          }

          const cardItem = new CardHistoryItem(
            rankChar,
            suitStr,
            guessAction,
            mult,
            isWin,
            false, // isFaceDown
            true   // invertActionPlacement
          );

          cardItem.scale.set(CARD_SCALE);
          cardItem.x = currentX;

          this.board.addChild(cardItem);

          currentX += cardItem.widthScaled + CARD_GAP;
        }
      });
    }

    // ScrollBox handles layout
  }

  public collapse() {
    if (this.expandSwitcher.active === 1) {
      this.expandSwitcher.switch(0);
      this.innerWrapper.visible = false;
      this.bg.visible = false;
    }
  }

  public expand() {
    if (this.expandSwitcher.active === 0) {
      this.expandSwitcher.switch(1);
    }
  }

  public get betIdText(): string {
    return this.betId.text;
  }

  private onExpandSwitcherChange(state: number | boolean) {
    this.innerWrapper.visible = state as boolean;
    this.bg.visible = state as boolean;

    this.onItemVisibleChange?.(state as boolean);

    if (state) {
      // Mock Data: Bypass API request
      this.updateLoadingTextVisible(false); // Hide loading immediately

      this.updateLoadingTextVisible(true);

      // Use static GameService
      GameService.historyDetail(this.betId.text)
        .then((response: HistoryDetailApiResponse) => {
          this.updateLoadingTextVisible(false);
          this.setBoard(response);
        })
        .catch(e => {
          console.error(e);
          this.updateLoadingTextVisible(false);
        });
    }
  }

  private updateLoadingTextVisible(visible: boolean) {
    this.loadingText.visible = visible;

    this.board.visible = !visible;
  }
}
