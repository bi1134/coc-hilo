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
          // Could restore card, multiplier etc here if needed
          const rankStr = this.numericToRank(data.last_activity.rank);
          const suitStr = this.numericToSuit(data.last_activity.suit);
          this.layout.currentCard.SetValue(rankStr, suitStr);
          this.multiplierManager.setMultiplier(data.last_activity.multiplier);
          this.EnterNonBettingState(true); // keepCard=true: don't overwrite resume card
        }

        // Set last bet as default input value
        if (data.last_bet) {
          this.layout.inputBox.value = data.last_bet.toString();
        }
      }
    } catch (error) {
      console.error("Failed to load player data from API:", error);
      // Fall back to default values
      this.layout.updateMoney(`${GameData.instance.totalMoney.toFixed(2)} `);
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
        const currentBet = parseFloat(this.layout.inputBox.value);
        const maxMoney = parseFloat(GameData.instance.totalMoney.toFixed(2));

        if (currentBet > maxMoney) {
          this.vibratePhone(100);
          return;
        }

        // Call API to start bet
        try {
          const response = await GameService.bet(currentBet, "start");
          const data = response.data;

          // Update balance from API response
          GameData.instance.totalMoney = data.balance;
          this.layout.updateMoney(`${data.balance.toFixed(2)} `);

          // Set initial card from API response
          const rankStr = this.numericToRank(data.rank);
          const suitStr = this.numericToSuit(data.suit);
          this.layout.currentCard.SetValue(rankStr, suitStr);

          // Update multiplier and odds from API
          this.multiplierManager.setMultiplier(data.multiplier);

          this.EnterNonBettingState(true); // keepCard=true: don't overwrite the real API card
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

    // Calculate Percentages
    let highProb = 0;
    let lowProb = 0;
    const total = 13;

    if (rank === "A") {
      // High Button -> Strict Higher (> A)
      highProb = (total - 1) / total;
      // Low Button -> Equal (== A)
      lowProb = 1 / total;
    } else if (rank === "K") {
      // High Button -> Equal (== K)
      highProb = 1 / total;
      // Low Button -> Strict Lower (< K)
      lowProb = (total - 1) / total;
    } else {
      // High Button -> Higher or Equal (>= Rank)
      // Ranks >= current: (total - rankIndex)
      highProb = (total - rankIndex) / total;

      // Low Button -> Lower or Equal (<= Rank)
      // Ranks <= current: (rankIndex + 1)
      lowProb = (rankIndex + 1) / total;
    }

    this.layout.titleHigh.text = `${(highProb * 100).toFixed(1)}% `;
    this.layout.titleLow.text = `${(lowProb * 100).toFixed(1)}% `;

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
    this.multiplierManager.reset();
    // Default multiplier 1.0, current bet from input
    const currentBet = parseFloat(this.layout.inputBox.value);
    const validBet = isNaN(currentBet) ? GameData.MIN_BET : currentBet;
    this.layout.multiplierBoard.updateValues(this.multiplierManager.currentMultiplier, validBet); // Init board

    if (!keepCard) {
      // Only randomize when NOT coming from a real API bet/resume
      this.layout.currentCard.RandomizeValue();
    }
    this.updateButtonLabels();

    this.layout.cardHistoryLayout.addCardToHistory(
      this.layout.currentCard.rank,
      this.layout.currentCard.suit,
      GuessAction.Start,
      0,
      -5,
      1,
      0.35, // 30% of original card size
      this.multiplierManager.currentMultiplier,
      true // isWin
    );
    GameData.instance.addCardHistory(
      this.layout.currentCard.rank,
      this.layout.currentCard.suit,
      GuessAction.Start,
      this.multiplierManager.currentMultiplier
    );

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

    this.updateButtonLabels();

    this.updateButtonLabels();
  }

  //#endregion

  private async CashOut() {
    try {
      const response = await GameService.cashout();
      const data = response.data;

      // Use MultiplierManager's tracked multiplier (includes combo bonuses)
      // NOT data.multiplier (which comes from mock that doesn't track combo)
      const multiplier = this.multiplierManager.currentMultiplier;
      const rawVal = parseFloat(this.layout.inputBox.value);
      const base = isNaN(rawVal) ? GameData.MIN_BET : rawVal;

      console.log(`[CashOut] Using MultiplierManager multiplier: ${multiplier}x (API returned: ${data.multiplier}x)`);

      UI.showResult(multiplier, base);

      // Show reveal animation
      this.layout.currentCard.playLoseAnimation();

      // Record result locally
      GameData.instance.addRoundResult(multiplier, true, base);
      this.layout.gameHistory.addResult(multiplier, true);

      // Update money display - calculate payout using correct multiplier
      const payout = base * multiplier;
      GameData.instance.totalMoney += payout;
      this.layout.updateMoney(`${GameData.instance.totalMoney.toFixed(2)} `);

      // Reset combo/multiplier on cashout
      this.multiplierManager.reset();

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
    switch (action) {
      case GuessAction.Higher:
        return "higher";
      case GuessAction.Lower:
        return "lower";
      case GuessAction.Equal:
        return "equal";
      case GuessAction.HigherOrEqual:
        return "higher_equal";
      case GuessAction.LowerOrEqual:
        return "lower_equal";
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
  private handlePickResponse(data: any, action: GuessAction) {
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
      // Reset multiplier from API (for sync on real API)
      this.multiplierManager.setMultiplier(1.0);

      const rawVal = parseFloat(this.layout.inputBox.value);
      const lostAmount = isNaN(rawVal) ? GameData.MIN_BET : rawVal;
      GameData.instance.addRoundResult(0, false, lostAmount);
      this.layout.gameHistory.addResult(0, false);

      this.layout.gameInfo.knightCharacter.playState('lose');
      this.layout.gameInfo.knightCharacter.say('YOU LOSE!');

      this.layout.currentCard.playLoseAnimation();
      this.layout.updateMoney(`${GameData.instance.totalMoney.toFixed(2)} `);

      // Reset combo on loss
      this.multiplierManager.reset();

      this.vibratePhone(200);
      this.EnterBettingState();

      // Force predictions to 0x on loss
      this.layout.gameInfo.updatePredictions(0, 0);
    } else if (action === GuessAction.Skip) {
      // Skip - don't reset multiplier, just reset combo counter
      this.multiplierManager.resetCounter();
      this.layout.gameInfo.knightCharacter.playState('skip');
      this.layout.gameInfo.knightCharacter.say("SKIPPED!");
    } else if (data.multiplier > 0) {
      // Win - let applyWin calculate the multiplier (preserves combo tracking)
      // DON'T call setMultiplier here - it would overwrite combo progress!
      this.multiplierManager.applyWin(prevRank, action);

      const prompt = this.multiplierManager.getComboPrompt(newRank, this.multiplierManager.currentMultiplier);
      const actionText = prompt.actionLabel;
      const infoText = `${prompt.remaining} more ${actionText} to receive`;
      const bonusText = `+${prompt.comboBonus}x`;
      const currentText = `x${this.multiplierManager.currentMultiplier}`;

      this.layout.gameInfo.knightCharacter.playState('win');
      this.layout.gameInfo.knightCharacter.say(infoText, 'combo', bonusText, currentText);

      this.enableButton(this.layout.betButton);

      // Update cash out value using MultiplierManager's value
      const rawVal = parseFloat(this.layout.inputBox.value);
      const validBet = isNaN(rawVal) ? GameData.MIN_BET : rawVal;
      const payout = validBet * this.multiplierManager.currentMultiplier;
      const formattedPayout = payout.toLocaleString('de-DE', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
      });
      this.layout.betButton.setCashOutValue(`RP ${formattedPayout}`);
    }

    // Update card history - pass 0 for loss, currentMultiplier for win
    const historyMultiplier = data.end_round ? 0 : this.multiplierManager.currentMultiplier;
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
