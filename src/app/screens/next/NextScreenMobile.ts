import { Container, Texture } from "pixi.js";
import { engine } from "../../getEngine";
import { MobileLayout } from "./layout/MobileLayout"; // Updated import
import { BetButton } from "../../ui/BetButton";
import { GameState, GuessAction } from "./types/GameTypes";
import { UI } from "../../ui/Manager/UIManager";
import { NextGameLogic } from "./logic/NextGameLogic";
import { GameData } from "../../data/GameData";
import { MultiplierManager } from "./logic/MultiplierManager";
import { GameService } from "../../api/services/GameService";
import { CardSuit } from "../../ui/Card";
import { SoundManager } from "../../audio/SoundManager";

export class NextScreenMobile extends Container {
  public static assetBundles = ["main"];

  public layout!: MobileLayout; // Renamed for clarity
  private multiplierManager: MultiplierManager;
  // private currentState: GameState = GameState.NonBetting; // Moved to GameData



  private firstLoad: boolean = true;

  constructor() {
    super();
    this.multiplierManager = new MultiplierManager();

    const { width, height } = engine().renderer.screen;

    this.layout = new MobileLayout(width, height);
    this.addChild(this.layout);

    // --- Setup Event Listeners ---
    this.setupEvents();

    this.layout.currentCard.RandomizeValue();
    this.EnterBettingState();

    this.resize(width, height);

    // Sync initial UI and load player data from API
    this.initializeFromApi();
  }

  /**
   * Initialize game state from API (lastActivity)
   */
  private async initializeFromApi() {
    try {
      const response = await GameService.lastActivity();
      const data = response.data;

      if (data) {
        // Initialize player data
        GameData.initFromApi(data.username, data.balance, data.currency);
        this.layout.updateMoney(`${data.balance.toFixed(2)} `);

        // Check if there's an active game session to resume
        if (data.last_activity && !data.last_activity.end_round) {
          console.log("Resuming active game session...");
          const activity = data.last_activity;

          // Restore card
          const rankStr = this.numericToRank(activity.rank);
          const suitStr = this.numericToSuit(activity.suit);
          this.layout.currentCard.SetValue(rankStr, suitStr);

          // Restore multiplier
          this.multiplierManager.setMultiplier(activity.multiplier);

          // Restore bet amount from last active bet
          if (activity.amount > 0) {
            this.layout.inputBox.value = activity.amount.toString();
          } else if (data.last_bet) {
            this.layout.inputBox.value = data.last_bet.toString();
          }

          // Enter non-betting state (keepCard=true)
          // NOTE: EnterNonBettingState clears history but does NOT add the initial card
          // when keepCard=true, so we can safely add all history cards below with no GSAP conflict.
          this.EnterNonBettingState(true);

          // Restore card history bar from history_cards array
          // Format: "n-4-11-0.00" → action-suit-rank-multiplier
          // EnterNonBettingState already cleared history, so no clearHistory() needed here.
          if (activity.history_cards && activity.history_cards.length > 0) {
            for (const cardStr of activity.history_cards) {
              const parts = cardStr.split("-");
              if (parts.length >= 4) {
                const actionCode = parts[0]; // n, s, h, l
                const suitNum = parseInt(parts[1]);
                const rankNum = parseInt(parts[2]);
                const mult = parseFloat(parts[3]);

                const hRank = this.numericToRank(rankNum);
                const hSuit = this.numericToSuit(suitNum);
                const hAction = this.historyCodeToGuessAction(actionCode);
                const isWin = actionCode !== 'l'; // 'l' = lower = lost

                const isStartCard = hAction === GuessAction.Start;
                const leftPad = isStartCard ? 0 : -20;

                this.layout.cardHistoryLayout.addCardToHistory(
                  hRank, hSuit, hAction, leftPad, -5, 1, 0.35, mult, isWin, false
                );

                GameData.instance.addCardHistory(
                  hRank, hSuit, hAction, mult
                );
              }
            }
          }

          // Enable cashout if there are winnings to collect
          if (activity.multiplier > 0) {
            this.enableButton(this.layout.betButton);
            const base = activity.amount > 0 ? activity.amount : (data.last_bet ?? 0);
            const payout = base * activity.multiplier;
            const formatted = payout.toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
            this.layout.betButton.setCashOutValue(`RP ${formatted}`);
          }

          // Character dialog: show current multiplier in combo style if winning
          if (activity.multiplier > 0) {
            const resumePrompt = this.multiplierManager.getComboPrompt(
              this.numericToRank(activity.rank),
              activity.multiplier
            );
            const infoText = `${resumePrompt.remaining} more ${resumePrompt.actionLabel} to receive`;
            const bonusText = `+${resumePrompt.comboBonus}x`;
            const currentText = `x${activity.multiplier.toFixed(2)}`;
            this.layout.gameInfo.knightCharacter.say(infoText, 'combo', bonusText, currentText);
          } else {
            this.layout.gameInfo.knightCharacter.say('PLAY ON!');
          }
        } else {
          // No active session — just set last bet as default input
          if (data.last_bet) {
            this.layout.inputBox.value = data.last_bet.toString();
          }
          // Character greets normally
          this.layout.gameInfo.knightCharacter.say("Press Bet \n to Start");
        }
      }
    } catch (error) {
      console.error("Failed to load player data from API:", error);
      this.layout.updateMoney(`${GameData.instance.totalMoney.toFixed(2)} `);
    }
  }

  /**
   * Convert history_cards action code to GuessAction
   * n = new/start, s = skip, h = higher, l = lower
   */
  private historyCodeToGuessAction(code: string): GuessAction {
    switch (code) {
      case 'h': return GuessAction.Higher;
      case 'l': return GuessAction.Lower;
      case 's': return GuessAction.Skip;
      default: return GuessAction.Start;
    }
  }


  private setupEvents() {

    this.layout.upButton.onPress.connect(() => this.HigherButton());
    this.layout.downButton.onPress.connect(() => this.LowerButton());
    this.layout.fancySkipButton.onPress.connect(() => this.SkipButton());
    this.layout.betButton.onPress.connect(async () => {
      if (this.betButtonIsCashOut()) {
        this.CashOut();
      } else {
        this.ValidateInput(); // Ensure valid input before betting
        // NaN (empty input) defaults to 0 — allow free play with 0 bet
        const rawBet = parseFloat(this.layout.inputBox.value);
        const currentBet = isNaN(rawBet) ? 0 : rawBet;
        const maxMoney = parseFloat(GameData.instance.totalMoney.toFixed(2));

        if (currentBet < 0 || currentBet > maxMoney) {
          this.vibratePhone(100);
          return;
        }

        // Call API to start bet
        try {
          const response = await GameService.bet(currentBet, "start");
          const data = response.data;

          // Guard: API returns data: null on errors (e.g. InsufficientBalance)
          if (!data) {
            console.error("Bet API returned null data — likely an API error.");
            return;
          }

          // Update balance from API response
          GameData.instance.totalMoney = data.balance;
          this.layout.updateMoney(`${data.balance.toFixed(2)} `);

          // Set initial card from API response
          const rankStr = this.numericToRank(data.rank);
          const suitStr = this.numericToSuit(data.suit);
          this.layout.currentCard.SetValue(rankStr, suitStr);

          // API bet returns multiplier 0. We start at 1.0 internally.
          this.multiplierManager.setMultiplier(1.0);

          this.EnterNonBettingState(true); // keepCard=true: don't overwrite the real API card

          // Always add the initial dealt card to history (even with keepCard)
          this.layout.cardHistoryLayout.addCardToHistory(
            this.layout.currentCard.rank,
            this.layout.currentCard.suit,
            GuessAction.Start,
            0, -5, 1, 0.35,
            this.multiplierManager.currentMultiplier,
            true,
            false // no slide animation for the very first card if it's already centered
          );

          // Initial dialog for 1.0x (or whatever the starting multiplier is)
          const prompt = this.multiplierManager.getComboPrompt(
            this.layout.currentCard.rank,
            this.multiplierManager.currentMultiplier
          );
          this.layout.gameInfo.knightCharacter.playState('win');
          this.layout.gameInfo.knightCharacter.say(
            `${prompt.remaining} more ${prompt.actionLabel} to receive`,
            'combo',
            `+${prompt.comboBonus}x`,
            `x${this.multiplierManager.currentMultiplier.toFixed(2)}`
          );

        } catch (error) {
          console.error("Bet API error:", error);
          // Error popup is handled by ApiClient
        }
      }
    });

    this.layout.halfValueButton.onPress.connect(() => this.HalfButton());
    this.layout.doubleValueButton.onPress.connect(() => this.DoubleButton());
  }

  private betButtonIsCashOut(): boolean {
    return !this.layout.betButton.isBetting;
  }

  private async HigherButton() {
    const rank = this.layout.currentCard.rank;
    const action = NextGameLogic.getHighAction(rank);
    // Convert GuessAction enum to API action string
    const actionStr = this.guessActionToApiString(action);
    await this.callPickApi(actionStr, action);
  }

  private async LowerButton() {
    const rank = this.layout.currentCard.rank;
    const action = NextGameLogic.getLowAction(rank);
    // Convert GuessAction enum to API action string
    const actionStr = this.guessActionToApiString(action);
    await this.callPickApi(actionStr, action);
  }

  private async SkipButton() {
    try {
      const currentRankNumeric = this.rankToNumeric(this.layout.currentCard.rank);
      const response = await GameService.skip(currentRankNumeric);
      this.handlePickResponse(response.data, GuessAction.Skip);
      this.layout.gameInfo.knightCharacter.playState('skip');
      this.layout.gameInfo.knightCharacter.say("YOU CAN DO IT!");
      this.vibratePhone(100);
    } catch (error) {
      console.error("Skip API error:", error);
    }
  }

  private HalfButton() {
    const currentValue = parseFloat(this.layout.inputBox.value);
    if (currentValue <= this.layout.inputDefaultValue) {
      this.layout.inputBox.value = this.layout.inputDefaultValue.toString();
    } else {
      const half = currentValue / 2;
      this.layout.inputBox.value = parseFloat(half.toFixed(2)).toString();
    }
  }

  private DoubleButton() {
    let currentValue = parseFloat(this.layout.inputBox.value);

    currentValue *= 2;

    const maxMoney = GameData.instance.totalMoney;
    if (currentValue > maxMoney) {
      currentValue = maxMoney;
    }

    this.layout.inputBox.value = parseFloat(currentValue.toFixed(2)).toString();
  }

  // Helper to update UI labels based on current card
  private updateButtonLabels() {
    const rank = this.layout.currentCard.rank;
    const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
    const rankIndex = ranks.indexOf(rank);


    const labels = NextGameLogic.getLabelData(rank);

    // Update Icons based on action (needed for payout calculation)
    const highAction = NextGameLogic.getHighAction(rank);
    const lowAction = NextGameLogic.getLowAction(rank);

    // Logic: Show Description on First Load, then switch to Payouts forever once game starts
    if (this.firstLoad) {
      this.layout.highDes.text = labels.highDesc;
      this.layout.lowDes.text = labels.lowDesc;
    } else {
      // Show Payouts (Rp XXX)
      const currentBet = parseFloat(this.layout.inputBox.value);
      const validBet = isNaN(currentBet) ? GameData.MIN_BET : currentBet;

      // Calculate Potential Multipliers
      const highNextMult = this.multiplierManager.getNextMultiplier(rank, highAction);
      const lowNextMult = this.multiplierManager.getNextMultiplier(rank, lowAction);

      // Calculate Potential Payouts
      const highPayout = validBet * highNextMult;
      const lowPayout = validBet * lowNextMult;

      const formatPayout = (val: number) => {
        return val.toLocaleString('de-DE', {
          minimumFractionDigits: 0,
          maximumFractionDigits: 2
        });
      };

      this.layout.highDes.text = `RP ${formatPayout(highPayout)} `;
      this.layout.lowDes.text = `RP ${formatPayout(lowPayout)} `;

      // Update Prediction Multipliers on the Board
      this.layout.gameInfo.updatePredictions(highNextMult, lowNextMult);
    }

    if (highAction === GuessAction.Equal) {
      this.layout.highIcon.texture = Texture.from("icon-equal.png");
    } else {
      this.layout.highIcon.texture = Texture.from("Icon-Arrow-high.png");
    }

    if (lowAction === GuessAction.Equal) {
      this.layout.lowIcon.texture = Texture.from("icon-equal.png");
    } else {
      this.layout.lowIcon.texture = Texture.from("Icon-Arrow-low.png");
    }

    // Use probabilities directly from API if we have them, otherwise fallback to local logic
    let highProb = 0;
    let lowProb = 0;

    // Check if we just got these from a recent API response (handlePickResponse or bet)
    // For now we calculate locally on hover to match the UI, but the API also returns 
    // chance_up and chance_down which should be used to calculate the real payout multiplier
    const total = 13;

    if (rank === "A") {
      highProb = (total - 1) / total;
      lowProb = 1 / total;
    } else if (rank === "K") {
      highProb = 1 / total;
      lowProb = (total - 1) / total;
    } else {
      highProb = (total - rankIndex) / total;
      lowProb = (rankIndex + 1) / total;
    }

    this.layout.titleHigh.text = `${(highProb * 100).toFixed(1)}% `;
    this.layout.titleLow.text = `${(lowProb * 100).toFixed(1)}% `;

    // For predicting the next payout, we use the local probability to calculate the real 
    // multiplier that the server will use (1 / prob * 0.98), then multiply by current multiplier
    const calcNextMult = (prob: number) => {
      if (prob <= 0) return 0;
      let m = (1 / prob) * 0.98;
      if (m < 1.0) m = 1.0;
      return parseFloat((this.multiplierManager.currentMultiplier * m).toFixed(2));
    };

    const highNextMult = calcNextMult(highProb);
    const lowNextMult = calcNextMult(lowProb);

    this.layout.gameInfo.updatePredictions(highNextMult, lowNextMult);

    // Update Next Multiplier Board (Prediction)
    // During betting state, show 0 since no winnings yet
    // During non-betting state, show current multiplier * bet
    const currentBet = parseFloat(this.layout.inputBox.value);
    const validBet = isNaN(currentBet) ? GameData.MIN_BET : currentBet;
    const boardBet = GameData.instance.currentState === GameState.Betting ? 0 : validBet;
    this.layout.multiplierBoard.updateValues(this.multiplierManager.currentMultiplier, boardBet);

  }



  private EnterNonBettingState(keepCard: boolean = false) {
    GameData.instance.currentState = GameState.NonBetting;

    // Force switch back to Spine view
    this.layout.currentCard.resetToIdle();

    GameData.instance.currentState = GameState.NonBetting;


    //clear card history
    this.layout.cardHistoryLayout.clearHistory();
    GameData.instance.resetGameSession();

    //prepare for new round
    if (
      !this.layout.cardsContainer.children.includes(this.layout.currentCard)
    ) {
      this.layout.cardsContainer.addChild(this.layout.currentCard);
    }

    // Reset Card?
    // Show back of card
    if (this.layout.currentCard.parent) {
      this.layout.currentCard.parent.removeChild(this.layout.currentCard);
    }

    // Re-add logic or ensure z-order
    if (this.layout.currentCard.parent !== this.layout.cardsContainer) {
      this.layout.cardsContainer.addChild(this.layout.currentCard);
    }

    // Ensure fancySkipButton is on top
    this.layout.cardsContainer.setChildIndex(
      this.layout.fancySkipButton,
      this.layout.cardsContainer.children.length - 1
    );

    // Only randomize if not keeping the card from API (bet/resume response)
    // When keepCard=true (resume), multiplier was already set before calling this — don't reset it
    if (!keepCard) {
      this.multiplierManager.reset();
    }
    // Default multiplier 1.0, current bet from input
    const currentBet = parseFloat(this.layout.inputBox.value);
    const validBet = isNaN(currentBet) ? GameData.MIN_BET : currentBet;
    this.layout.multiplierBoard.updateValues(this.multiplierManager.currentMultiplier, validBet); // Init board

    if (!keepCard) {
      // Only randomize when NOT coming from a real API bet/resume
      this.layout.currentCard.RandomizeValue();
    }
    this.updateButtonLabels();

    // Only add the starting card to history when NOT resuming.
    // On resume, initializeFromApi will rebuild the full history from the API
    // without a clearHistory() that would destroy these GSAP-animated items.
    if (!keepCard) {
      this.layout.cardHistoryLayout.addCardToHistory(
        this.layout.currentCard.rank,
        this.layout.currentCard.suit,
        GuessAction.Start,
        0,
        -5,
        1,
        0.35,
        this.multiplierManager.currentMultiplier,
        true
      );
      GameData.instance.addCardHistory(
        this.layout.currentCard.rank,
        this.layout.currentCard.suit,
        GuessAction.Start,
        this.multiplierManager.currentMultiplier
      );
    }

    //input and buttons
    this.layout.inputBox.interactive = false;
    this.layout.betButton.setBettingState(false); // Non-Betting -> 1-0, Cash Out

    // Set initial cash out value (Start Bet)
    const initialPayout = validBet * this.multiplierManager.currentMultiplier; // Should be 1.0

    const formattedInitial = initialPayout.toLocaleString('de-DE', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    });
    this.layout.betButton.setCashOutValue(`RP ${formattedInitial}`);

    this.layout.halfValueButton.interactive = false;
    this.layout.doubleValueButton.interactive = false;
    this.disableButton(this.layout.betButton); // Cashout disabled until player wins a pick (higher/lower)

    this.enableButton(this.layout.upButton);
    this.enableButton(this.layout.downButton);
    this.layout.fancySkipButton.interactive = true;

    this.firstLoad = false; // Game has started, switching to Payout mode permanently
  }

  private EnterBettingState() {
    GameData.instance.currentState = GameState.Betting;

    // Force Mesh View during betting (so it doesn't flip back to Spine on hover out)
    this.layout.currentCard.forceMeshView = true;

    // Enable input again for new round
    this.layout.inputBox.interactive = true;
    this.layout.betButton.setBettingState(true); // Betting -> 1-1, Bet
    this.enableButton(this.layout.betButton);
    this.layout.halfValueButton.interactive = true;
    this.layout.doubleValueButton.interactive = true;

    this.disableButton(this.layout.upButton);
    this.disableButton(this.layout.downButton);

    this.layout.fancySkipButton.interactive = false;

    // Note: do NOT say anything here — the caller (CashOut / loss handler)
    // is responsible for making the character speak before entering betting state.
    this.updateButtonLabels();
  }

  //#endregion

  private async CashOut() {
    try {
      const cashoutResponse = await GameService.cashout();
      const cashoutData = cashoutResponse.data;

      if (!cashoutData) {
        console.error("Cashout API returned null data.");
        return;
      }

      // Use MultiplierManager's tracked multiplier (includes combo bonuses)
      const multiplier = this.multiplierManager.currentMultiplier;
      const rawVal = parseFloat(this.layout.inputBox.value);
      const base = isNaN(rawVal) ? 0 : rawVal;

      console.log(`[CashOut] multiplier: ${multiplier}x, base: ${base}`);

      UI.showResult(multiplier, base);

      // Show reveal animation
      this.layout.currentCard.playLoseAnimation();

      // Record result locally
      GameData.instance.addRoundResult(multiplier, true, base);
      this.layout.gameHistory.addResult(multiplier, true);

      // Try to get updated balance from result API (authoritative end of round)
      try {
        const resultRes = await GameService.result();
        if (resultRes?.data?.balance !== undefined) {
          GameData.instance.totalMoney = resultRes.data.balance;
          this.layout.updateMoney(`${resultRes.data.balance.toFixed(2)} `);
        }
      } catch (resultError) {
        console.warn("Result API error (non-critical):", resultError);
        // Fallback to cashout data if result fails
        GameData.instance.totalMoney = cashoutData.balance ?? GameData.instance.totalMoney;
        this.layout.updateMoney(`${GameData.instance.totalMoney.toFixed(2)} `);
      }

      // Character: prompt next round
      this.layout.gameInfo.knightCharacter.say("Press Bet \n to Start");

      this.EnterBettingState();

      // Clear history bar and reset predictions to 0x after entering betting state
      this.layout.cardHistoryLayout.clearHistory();
      this.layout.gameInfo.updatePredictions(0, 0);
    } catch (error) {
      console.error("Cashout API error:", error);
      // Error popup is handled by ApiClient
    }
  }

  private ValidateInput() {
    let val = parseFloat(this.layout.inputBox.value);

    // reset invalid or below-zero values
    if (isNaN(val) || val < 0) {
      this.layout.inputBox.value = GameData.MIN_BET.toString();
      return;
    }

    // Cap at total money
    const maxMoney = GameData.instance.totalMoney;
    if (val > maxMoney) {
      val = maxMoney;
    }

    // Format: Remove unnecessary decimals (e.g. 3.00 -> 3) but keep up to 2 decimals
    this.layout.inputBox.value = parseFloat(val.toFixed(2)).toString();
  }

  public prepare() { }

  public reset() { }



  public resize(width: number, height: number) {
    // Pass through resize directly to layout
    // The engine (ResizePlugin) now handles letterboxing and scaling.
    // We just need to fit our layout into the provided width/height.
    this.layout.resize(width, height, width * 0.02, 0);
  }

  public async show(): Promise<void> {
    SoundManager.playBGM(0.5);
  }

  private disableButton(button: any) {
    if (button instanceof BetButton) {
      button.setEnabled(false);
    } else {
      button.interactive = false;
      button.alpha = 0.75;
    }
  }

  private enableButton(button: any) {
    if (button instanceof BetButton) {
      button.setEnabled(true);
    } else {
      button.interactive = true;
      button.alpha = 1;
    }
  }

  private vibratePhone(power: number = 100) {
    if (navigator && navigator.vibrate) {
      navigator.vibrate(power);
    }
  }

  // --- API Helper Methods ---

  /**
   * Convert numeric rank (1-13) from API to string rank (A, 2-10, J, Q, K)
   */
  private numericToRank(num: number): string {
    const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
    if (num >= 1 && num <= 13) {
      return ranks[num - 1];
    }
    return "A"; // Default fallback
  }

  /**
   * Convert numeric suit (1-4) from API to string suit
   * 1 = Diamonds (♦), 2 = Clubs (♣), 3 = Hearts (♥), 4 = Spades (♠)
   */
  private numericToSuit(num: number): CardSuit {
    const suits: CardSuit[] = ["diamond", "club", "heart", "spade"];
    if (num >= 1 && num <= 4) {
      return suits[num - 1];
    }
    return "spade"; // Default fallback
  }

  /**
   * Convert GuessAction enum to API action string
   */
  private guessActionToApiString(action: GuessAction): string {
    // Backend only accepts 3 action strings and handles all edge cases internally:
    // "higher" → backend treats as >= (higher or equal); for K, treated as equal
    // "lower"  → backend treats as <= (lower or equal); for A, treated as equal
    // "skip"   → skip the card
    switch (action) {
      case GuessAction.Higher:
      case GuessAction.HigherOrEqual:
      case GuessAction.Equal:       // K high btn — backend resolves to equal internally
        return "higher";
      case GuessAction.Lower:
      case GuessAction.LowerOrEqual:
        return "lower";
      case GuessAction.Skip:
        return "skip";
      default:
        return "higher";
    }
  }

  /**
   * Call pick API with action (higher/lower) and handle response
   */
  private async callPickApi(action: string, guessAction: GuessAction) {
    try {
      const currentRankNumeric = this.rankToNumeric(this.layout.currentCard.rank);
      const response = await GameService.pick(action, currentRankNumeric);
      this.handlePickResponse(response.data, guessAction);
    } catch (error) {
      console.error(`Pick API error (${action}):`, error);
    }
  }

  /**
   * Convert string rank to numeric (A=1, 2=2, ..., K=13)
   */
  private rankToNumeric(rank: string): number {
    const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
    const index = ranks.indexOf(rank);
    return index >= 0 ? index + 1 : 1; // A=1, 2=2, ..., K=13
  }

  /**
   * Handle API response for pick/skip actions
   */
  private async handlePickResponse(data: any, action: GuessAction) {
    const prevRank = this.layout.currentCard.rank;

    // Update card from API response
    const newRank = this.numericToRank(data.rank);
    const newSuit = this.numericToSuit(data.suit);

    // Visual Transition: Fly off old card
    this.layout.animateFlyOff(prevRank, this.layout.currentCard.suit);
    this.layout.animateDeal();

    // Update card visual
    this.layout.currentCard.SetValue(newRank, newSuit);

    // Check game state
    if (data.end_round) {
      // Game ended - player lost
      this.multiplierManager.setMultiplier(1.0);

      const rawVal = parseFloat(this.layout.inputBox.value);
      const lostAmount = isNaN(rawVal) ? 0 : rawVal;
      GameData.instance.addRoundResult(0, false, lostAmount);
      this.layout.gameHistory.addResult(0, false);

      this.layout.gameInfo.knightCharacter.playState('lose');
      this.layout.gameInfo.knightCharacter.say('YOU LOSE!');

      this.layout.currentCard.playLoseAnimation();
      this.layout.updateMoney(`${GameData.instance.totalMoney.toFixed(2)} `);

      // Reset combo on loss
      this.multiplierManager.reset();

      this.vibratePhone(200);

      // Finalize round with backend on loss and sync balance
      try {
        const resultRes = await GameService.result();
        if (resultRes?.data?.balance !== undefined) {
          GameData.instance.totalMoney = resultRes.data.balance;
          this.layout.updateMoney(`${resultRes.data.balance.toFixed(2)} `);
        }
      } catch (resultError) {
        console.warn("Result API error on loss (non-critical):", resultError);
      }
      // Enter betting state WITHOUT overriding the YOU LOSE dialog
      // EnterBettingState will say 'Press Bet' but we want YOU LOSE to show briefly first
      setTimeout(() => {
        this.EnterBettingState();
        // Force predictions to 0x on loss
        this.layout.gameInfo.updatePredictions(0, 0);
      }, 1500);

    } else if (action === GuessAction.Skip) {
      // Skip - don't reset multiplier, just reset combo counter
      this.multiplierManager.resetCounter();
      this.layout.gameInfo.knightCharacter.playState('skip');
      this.layout.gameInfo.knightCharacter.say("SKIPPED!");
    } else {
      // Win — detect by end_round=false and non-skip action

      // Override local multiplier strictly with API multiplier
      const newMultiplier = data.multiplier || this.multiplierManager.currentMultiplier;
      this.multiplierManager.setMultiplier(newMultiplier);

      // Let MultiplierManager process the logic for combo UI
      // (This will increment the combo counter visually)
      this.multiplierManager.applyWin(prevRank, action);

      // We explicitly override the tracked value to ensure it matches the server exactly
      this.multiplierManager.setMultiplier(newMultiplier);

      const prompt = this.multiplierManager.getComboPrompt(newRank, newMultiplier);
      const actionText = prompt.actionLabel;
      const infoText = `${prompt.remaining} more ${actionText} to receive`;
      const bonusText = `+${prompt.comboBonus}x`;
      const currentText = `x${newMultiplier.toFixed(2)}`;

      this.layout.gameInfo.knightCharacter.playState('win');
      this.layout.gameInfo.knightCharacter.say(infoText, 'combo', bonusText, currentText);

      this.enableButton(this.layout.betButton);

      // Update cash out value using the explicit API multiplier
      const rawVal = parseFloat(this.layout.inputBox.value);
      const validBet = isNaN(rawVal) ? GameData.MIN_BET : rawVal;
      const payout = validBet * newMultiplier;
      const formattedPayout = payout.toLocaleString('de-DE', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
      });
      this.layout.betButton.setCashOutValue(`RP ${formattedPayout}`);
    }

    // Update card history
    const historyMultiplier = data.end_round ? 0 : this.multiplierManager.currentMultiplier;

    // Use exact server odds if available for predicting the next state
    if (data.chance_up !== undefined && data.chance_down !== undefined) {
      if (!data.end_round) {
        // Calculate payout factors dynamically from server chances
        const calcNextMult = (chance: number) => {
          if (chance <= 0) return 0;
          let m = (1 / (chance / 100)) * 0.98;
          if (m < 1.0) m = 1.0;
          return parseFloat((this.multiplierManager.currentMultiplier * m).toFixed(2));
        };
        const highNextMult = calcNextMult(data.chance_up);
        const lowNextMult = calcNextMult(data.chance_down);
        this.layout.gameInfo.updatePredictions(highNextMult, lowNextMult);
      }
    }
    this.layout.cardHistoryLayout.addCardToHistory(
      newRank,
      newSuit,
      action,
      -20,
      -5,
      1,
      0.35,
      historyMultiplier,
      !data.end_round
    );
    GameData.instance.addCardHistory(
      newRank,
      newSuit,
      action,
      this.multiplierManager.currentMultiplier
    );

    // Update multiplier board
    const currentBet = parseFloat(this.layout.inputBox.value);
    const validBet = isNaN(currentBet) ? GameData.MIN_BET : currentBet;
    this.layout.multiplierBoard.updateValues(this.multiplierManager.currentMultiplier, validBet);

    // Only update button labels if the round is continuing (Win/Skip)
    // If we lost, EnterBettingState handled it, and we don't want to show predictions for the next card immediately.
    if (!data.end_round) {
      this.updateButtonLabels();
    }
  }
}
