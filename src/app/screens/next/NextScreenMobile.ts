import { Container, Texture, Filter, ColorMatrixFilter } from "pixi.js";
import { gsap } from "gsap";
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
import { SelectiveRedFilter } from "../../utils/SelectiveRedFilter";

export class NextScreenMobile extends Container {
  public static assetBundles = ["main"];

  public layout!: MobileLayout; // Renamed for clarity
  private multiplierManager: MultiplierManager;
  // private currentState: GameState = GameState.NonBetting; // Moved to GameData



  private firstLoad: boolean = true;
  private isProcessingAction: boolean = false;
  private lossGrayscaleFilter: Filter;

  // --- Dummy Proxy Card Injection State ---
  private dummyInjectionActive: boolean = false;
  private dummyCardsTarget: number = 0;
  private dummyCardsInjected: number = 0;
  private dummyDelayMs: number = 100;

  constructor() {
    super();
    this.multiplierManager = new MultiplierManager();

    const { width, height } = engine().renderer.screen;

    this.layout = new MobileLayout(width, height);
    this.addChild(this.layout);

    // Custom WebGL Filter setup for loss impact screen flash (Selective Red)
    this.lossGrayscaleFilter = SelectiveRedFilter.create();

    // --- Setup Event Listeners ---
    this.setupEvents();

    this.layout.currentCard.RandomizeValue(false);
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

      // Also fire off a request to grab the latest 10 games for the history ribbon
      GameService.history(1).then(historyRes => {
        if (historyRes?.data?.length) {
          // Take top 10 most recent games, and reverse them to feed into the history layout oldest -> newest format
          const recentGames = historyRes.data.slice(0, 10).reverse();
          for (const game of recentGames) {
            const mult = game.game_info?.minigames?.multiplier || game.multiplier || 0;
            const isWin = mult > 0;
            const txId = game.bet_id || game.txId || undefined;
            this.layout.gameHistory.addResult(mult, isWin, txId);
          }
        }
      }).catch(err => {
        console.warn("Could not load initial history ribbon:", err);
      });

      if (data) {
        // Initialize player data
        GameData.initFromApi(data.username, data.balance, data.currency);
        this.layout.updateMoney(`${data.balance.toFixed(2)} `);

        // Check if there's an active game session to resume
        if (data.last_activity && !data.last_activity.end_round) {
          console.log("Resuming active game session...");
          const activity = data.last_activity;

          // Restore multiplier
          this.multiplierManager.setMultiplier(activity.multiplier);

          // Restore bet amount from last active bet
          if (activity.amount > 0) {
            this.layout.inputBox.value = activity.amount.toString();
          } else if (data.last_bet) {
            this.layout.inputBox.value = data.last_bet.toString();
          }

          // Enter non-betting state (keepCard=true) FIRST so resetToIdle runs cleanly
          // Then apply the restored card skin AFTER so no animation gets stomped
          this.EnterNonBettingState(true);

          // Restore card skin AFTER resetToIdle, with flip animation to reveal the card
          const rankStr = this.numericToRank(activity.rank);
          const suitStr = this.numericToSuit(activity.suit);
          this.layout.currentCard.SetValue(rankStr, suitStr, true);

          // Restore card history bar from history_cards array
          // Format: "n-4-11-0.00" → action-suit-rank-multiplier
          // EnterNonBettingState already cleared history, so no clearHistory() needed here.
          if (activity.history_cards && activity.history_cards.length > 0) {
            
            // Check if we need to pad the visual layout with dummy cards (User requested minimum 6 objects on screen)
            const requiredVisCards = 6;
            const dummyPaddingCount = requiredVisCards - activity.history_cards.length;
            
            if (dummyPaddingCount > 0) {
              await this.injectDummyCards(dummyPaddingCount, 100);
            }

            // Begin staggering real cards. Use the same async boolean so user actions (Bet/High/Low) can instantly skip the stagger.
            this.dummyInjectionActive = true;

            for (let i = 0; i < activity.history_cards.length; i++) {
              if (!this.dummyInjectionActive) {
                // If user pressed a button, instantly dump the rest of the array onto the board
                for (let j = i; j < activity.history_cards.length; j++) {
                  this.processHistoryCardString(activity.history_cards[j], true); // true = instant layout
                }
                break;
              }

              this.processHistoryCardString(activity.history_cards[i], false); // false = async layout
              await new Promise(resolve => setTimeout(resolve, this.dummyDelayMs)); // staggered delay loop
            }

            this.dummyInjectionActive = false; // complete
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

          // Inject facedown proxy cards logically to provide a placeholder trail initially with a tiny stagger
          await this.injectDummyCards(5, 100);
        }
      }
    } catch (error) {
      console.error("Failed to load player data from API:", error);
      this.layout.updateMoney(`${GameData.instance.totalMoney.toFixed(2)} `);
    }
  }

  /**
   * Helper to parse and render a single history_cards string during api reloads
   */
  private processHistoryCardString(cardStr: string, instantLayout: boolean) {
    const parts = cardStr.split("-");
    if (parts.length >= 4) {
      const actionCode = parts[0]; // n, s, h, l
      const suitNum = parseInt(parts[1]);
      const rankNum = parseInt(parts[2]);
      const mult = parseFloat(parts[3]);

      const hRank = this.numericToRank(rankNum);
      const hSuit = this.numericToSuit(suitNum);
      const hAction = this.historyCodeToGuessAction(actionCode);
      // history_cards only exists for an ACTIVE (non-ended) session — all picks here are wins
      const isWin = true;

      const leftPad = -20; // Always -20 to match live gameplay card spacing

      this.layout.cardHistoryLayout.addCardToHistory(
        hRank, hSuit, hAction, leftPad, -5, 1, 0.35, mult, isWin, false, instantLayout, false
      );

      GameData.instance.addCardHistory(
        hRank, hSuit, hAction, mult
      );
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
      this.finishDummyInjection(); // instantly flush proxy cards if still staggering in
      if (this.isProcessingAction) return;
      this.isProcessingAction = true;
      try {
        if (this.betButtonIsCashOut()) {
          await this.CashOut();
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

          const hasRealCards = GameData.instance.cardHistory.length > 0;

          this.EnterNonBettingState(true, !hasRealCards); // keepCard=true: don't overwrite the real API card, keepHistory if we already have dummies

          // If the history previously contained a lost game (real cards), we just wiped it and need to inject fresh proxy cards gracefully before the real start card.
          if (hasRealCards) {
            await this.injectDummyCards(5, 100);
          }

          // Always add the initial dealt card to history (even with keepCard)
          this.layout.cardHistoryLayout.addCardToHistory(
            this.layout.currentCard.rank,
            this.layout.currentCard.suit,
            GuessAction.Start,
            -20, -5, 1, 0.35,
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

        }
      } catch (error) {
        console.error("Bet API error:", error);
        // Error popup is handled by ApiClient
      } finally {
        this.isProcessingAction = false;
      }
    });

    this.layout.halfValueButton.onPress.connect(() => this.HalfButton());
    this.layout.doubleValueButton.onPress.connect(() => this.DoubleButton());
    this.layout.inputBox.onChange.connect(() => this.updateButtonStates());
  }

  private betButtonIsCashOut(): boolean {
    return !this.layout.betButton.isBetting;
  }

  private async HigherButton() {
    this.finishDummyInjection();
    if (this.isProcessingAction) return;
    this.isProcessingAction = true;
    try {
      const rank = this.layout.currentCard.rank;
      const action = NextGameLogic.getHighAction(rank);
      // Convert GuessAction enum to API action string
      const actionStr = this.guessActionToApiString(action, rank);
      await this.callPickApi(actionStr, action);
    } finally {
      this.isProcessingAction = false;
    }
  }

  private async LowerButton() {
    this.finishDummyInjection();
    if (this.isProcessingAction) return;
    this.isProcessingAction = true;
    try {
      const rank = this.layout.currentCard.rank;
      const action = NextGameLogic.getLowAction(rank);
      // Convert GuessAction enum to API action string
      const actionStr = this.guessActionToApiString(action, rank);
      await this.callPickApi(actionStr, action);
    } finally {
      this.isProcessingAction = false;
    }
  }

  private async SkipButton() {
    this.finishDummyInjection();
    if (this.isProcessingAction) return;
    this.isProcessingAction = true;
    try {
      const currentRankNumeric = this.rankToNumeric(this.layout.currentCard.rank);
      const response = await GameService.skip(currentRankNumeric);
      await this.handlePickResponse(response.data, GuessAction.Skip);
      this.layout.gameInfo.knightCharacter.playState('skip');
      this.layout.gameInfo.knightCharacter.say("YOU CAN DO IT!");
      this.vibratePhone(100);
    } catch (error) {
      console.error("Skip API error:", error);
    } finally {
      this.isProcessingAction = false;
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
    this.updateButtonStates();
  }

  private DoubleButton() {
    let currentValue = parseFloat(this.layout.inputBox.value);

    currentValue *= 2;

    const maxMoney = GameData.instance.totalMoney;
    if (currentValue > maxMoney) {
      currentValue = maxMoney;
    }

    this.layout.inputBox.value = parseFloat(currentValue.toFixed(2)).toString();
    this.updateButtonStates();
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



  private EnterNonBettingState(keepCard: boolean = false, keepHistory: boolean = false) {
    GameData.instance.currentState = GameState.NonBetting;

    // Force switch back to Spine view
    this.layout.currentCard.resetToIdle();

    // Remove greyscale from hi/lo buttons and card
    this.layout.gameLogic.setGreyscale(false);

    if (!keepHistory) {
      //clear card history
      this.layout.cardHistoryLayout.clearHistory();
    }
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
      this.layout.currentCard.RandomizeValue(false);
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
        -20,
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
    this.layout.betBar.settingsUI.updateUI(false);
    this.layout.gameHistory.interactiveChildren = false;
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

    // Grayscale during bet round
    const grayscaleFilter = new ColorMatrixFilter();
    grayscaleFilter.grayscale(0.35, false);
    this.layout.halfValueButton.filters = [grayscaleFilter];
    this.layout.doubleValueButton.filters = [grayscaleFilter];

    this.disableButton(this.layout.betButton); // Cashout disabled until player wins a pick (higher/lower)

    this.enableButton(this.layout.upButton);
    this.enableButton(this.layout.downButton);
    this.layout.fancySkipButton.interactive = true;

    this.firstLoad = false; // Game has started, switching to Payout mode permanently
    this.layout.gameLogic.updateButtonGlows(this.multiplierManager.comboDirection, this.multiplierManager.comboStreak);
  }

  private EnterBettingState() {
    GameData.instance.currentState = GameState.Betting;

    // Force Mesh View during betting (so it doesn't flip back to Spine on hover out)
    this.layout.currentCard.forceMeshView = true;

    // Enable input again for new round
    this.layout.inputBox.interactive = true;
    this.layout.betBar.settingsUI.updateUI(true);
    this.layout.gameHistory.interactiveChildren = true;

    this.layout.betButton.setBettingState(true); // Betting -> 1-1, Bet
    this.enableButton(this.layout.betButton);

    this.updateButtonStates(); // Re-enable half/double based on balance 

    this.layout.halfValueButton.interactive = true;
    this.layout.doubleValueButton.interactive = true;

    this.disableButton(this.layout.upButton);
    this.disableButton(this.layout.downButton);

    this.layout.fancySkipButton.interactive = false;

    // Greyscale hi/lo buttons and card to emphasize loss / betting state
    this.layout.gameLogic.setGreyscale(true);

    // Reset combo glow effects
    this.layout.gameLogic.updateButtonGlows(null, 0);

    // Note: do NOT say anything here — the caller (CashOut / loss handler)
    // is responsible for making the character speak before entering betting state.
    this.updateButtonLabels();
  }

  private async injectDummyCards(count: number = 5, delayMs: number = 100) {
    this.finishDummyInjection(); // Cancel any existing

    this.dummyInjectionActive = true;
    this.dummyCardsTarget = count;
    this.dummyCardsInjected = 0;
    this.dummyDelayMs = delayMs;

    while (this.dummyInjectionActive && this.dummyCardsInjected < this.dummyCardsTarget) {
      this.layout.cardHistoryLayout.addCardToHistory(
        "A", "spades", GuessAction.Start, -20, -5, 1, 0.35, 1.0, true, false, true, false
      );
      this.dummyCardsInjected++;

      if (this.dummyCardsInjected < this.dummyCardsTarget && this.dummyInjectionActive) {
        await new Promise(resolve => setTimeout(resolve, this.dummyDelayMs)); // staggered delay loop
      }
    }
    this.dummyInjectionActive = false;
  }

  private finishDummyInjection() {
    if (this.dummyInjectionActive) {
      this.dummyInjectionActive = false; // Stop the async loop from continuing
      
      // Instantly inject the remaining cards
      while (this.dummyCardsInjected < this.dummyCardsTarget) {
        this.layout.cardHistoryLayout.addCardToHistory(
          "A", "spades", GuessAction.Start, -20, -5, 1, 0.35, 1.0, true, false, true, true // instantLayout=true
        );
        this.dummyCardsInjected++;
      }
    }
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
      const historyItem = this.layout.gameHistory.addResult(multiplier, true);

      // Silently fetch the real transaction ID from history after a short delay
      // to guarantee the backend database has fully committed the round result.
      setTimeout(() => {
        GameService.history(1).then(res => {
          if (res.data && res.data[0]) historyItem.txId = res.data[0].bet_id || res.data[0].txId;
        }).catch(e => console.warn("Failed to retroactive load history ID:", e));
      }, 1500);

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
      GameData.instance.resetGameSession();
      this.layout.gameInfo.updatePredictions(0, 0);

      // Inject dummy cards gracefully
      this.injectDummyCards(5, 100);
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

    this.updateButtonStates();
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

  private updateButtonStates() {
    const val = parseFloat(this.layout.inputBox.value);
    const money = GameData.instance.totalMoney;

    const grayscaleFilter = new ColorMatrixFilter();
    grayscaleFilter.grayscale(0.35, false);

    // 1/2 Button Logic
    if (isNaN(val) || val <= GameData.MIN_BET) {
      this.layout.halfValueButton.interactive = false;
      this.layout.halfValueButton.filters = [grayscaleFilter];
    } else {
      this.layout.halfValueButton.interactive = true;
      this.layout.halfValueButton.filters = [];
    }

    // x2 Button Logic
    if (isNaN(val) || val >= money) {
      this.layout.doubleValueButton.interactive = false;
      this.layout.doubleValueButton.filters = [grayscaleFilter];
    } else {
      this.layout.doubleValueButton.interactive = true;
      this.layout.doubleValueButton.filters = [];
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
  private guessActionToApiString(action: GuessAction, rank: string): string {
    // Backend only accepts 3 action strings and handles all edge cases internally:
    // "higher" → backend treats as >= (higher or equal); for K, treated as equal
    // "lower"  → backend treats as <= (lower or equal); for A, treated as equal
    // "skip"   → skip the card
    switch (action) {
      case GuessAction.Higher:
      case GuessAction.HigherOrEqual:
        return "higher";
      case GuessAction.Equal:
        return rank === "A" ? "lower" : "higher";
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
      await this.handlePickResponse(response.data, guessAction);
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
      const historyItem = this.layout.gameHistory.addResult(0, false);

      // Silently fetch the real transaction ID from history after a short delay
      // to guarantee the backend database has fully committed the round result.
      setTimeout(() => {
        GameService.history(1).then(res => {
          if (res.data && res.data[0]) historyItem.txId = res.data[0].bet_id || res.data[0].txId;
        }).catch(e => console.warn("Failed to retroactive load history ID:", e));
      }, 1500);

      this.layout.gameInfo.knightCharacter.playState('lose');
      this.layout.gameInfo.knightCharacter.say('YOU LOSE!');

      this.layout.currentCard.playLoseAnimation();
      this.layout.updateMoney(`${GameData.instance.totalMoney.toFixed(2)} `);

      // Reset combo on loss
      this.multiplierManager.reset();

      // --- Trigger Full-Screen Selective Color (Red) Fade Effect ---
      this.filters = [this.lossGrayscaleFilter];
      
      const lossProxy = { val: 1 }; // 1 = full selective grayscale, 0 = normal color

      gsap.to(lossProxy, {
        val: 0,
        duration: 1.5,
        ease: "power2.inOut",
        onUpdate: () => {
          // Update the custom shader uniform
          this.lossGrayscaleFilter.resources.filterUniforms.uniforms.uAlpha = lossProxy.val;
        },
        onComplete: () => {
          this.filters = []; // remove filter when fully normal
        }
      });

      this.vibratePhone(200);

      // Enter betting state immediately as requested (no artificial delay and no waiting for API)
      this.EnterBettingState();
      // Force predictions to 0x on loss
      this.layout.gameInfo.updatePredictions(0, 0);

      // Finalize round with backend on loss and sync balance (run async in background so we don't freeze UI)
      GameService.result().then(resultRes => {
        if (resultRes?.data?.balance !== undefined) {
          GameData.instance.totalMoney = resultRes.data.balance;
          this.layout.updateMoney(`${resultRes.data.balance.toFixed(2)} `);
        }
      }).catch(resultError => {
        console.warn("Result API error on loss (non-critical):", resultError);
      });

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
      const formattedPayout = payout.toLocaleString('en-US', {
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

    // Only update button labels and board if the round is continuing (Win/Skip)
    // If we lost, EnterBettingState handled resetting the board to 0.
    if (!data.end_round) {
      this.updateButtonLabels();
      this.layout.gameLogic.updateButtonGlows(this.multiplierManager.comboDirection, this.multiplierManager.comboStreak);
    }
  }
}
