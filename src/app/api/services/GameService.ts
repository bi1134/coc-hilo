import { ApiClient } from "../ApiClient";
import { ApiRoute } from "../ApiRoute";
import { BetApiResponse, mockBetResponse } from "../models/BetResponse";
import { CashoutApiResponse, mockCashoutResponse } from "../models/CashoutResponse";
import { LastActivityApiResponse, mockLastActivityResponse } from "../models/LastActivityResponse";
import { mockPickResponse, PickApiResponse } from "../models/PickResponse";
import { HistoryApiResponse, mockHistoryResponse } from "../models/HistoryResponse";
import { HistoryDetailApiResponse, mockHistoryDetailResponse } from "../models/HistoryDetailResponse";
import { ResultApiResponse, mockResultResponse } from "../models/ResultResponse";
import { GameData } from "../../data/GameData";

export class GameService {
  // Track mock game state
  private static mockMultiplier: number = 1.0;
  private static mockBetAmount: number = 0;

  public static async lastActivity(): Promise<LastActivityApiResponse> {
    const res = await ApiClient.get(ApiRoute.LAST_ACTIVITY);

    if (res.useMock) {
      // Return mock with current local balance
      const response = { ...mockLastActivityResponse };
      response.data = {
        ...response.data,
        balance: GameData.instance.totalMoney,
        username: GameData.instance.username,
        currency: GameData.instance.currency,
      };
      return response;
    }
    return res.data as LastActivityApiResponse;
  }

  public static async bet(
    amount: number,
    action: string = "start"
  ): Promise<BetApiResponse> {
    const body = {
      amount: amount,
      action: action,
    };
    const res = await ApiClient.post(ApiRoute.BET, body);
    if (res.useMock) {
      // Deduct bet from local balance and generate random card
      GameData.instance.totalMoney -= amount;
      this.mockBetAmount = amount;
      this.mockMultiplier = 1.0;

      // Generate and store the initial card rank
      const newRank = this.randomRank();


      const response: BetApiResponse = {
        data: {
          ...mockBetResponse.data,
          balance: GameData.instance.totalMoney,
          rank: newRank,
          suit: this.randomSuit(),
          amount: amount,
          multiplier: 1.0,
          total_win: 0,
          chance_up: this.calculateChanceUp(newRank),
          chance_down: this.calculateChanceDown(newRank),
        }
      };
      return response;
    }
    return res.data as BetApiResponse;
  }

  public static async skip(currentRank: number = 1): Promise<PickApiResponse> {
    const body = {
      action: "skip",
    };
    const res = await ApiClient.post(ApiRoute.PICK, body);
    if (res.useMock) {
      // Skip: new card, keeps multiplier, always succeeds
      return this.generateMockPickResponse("skip", currentRank);
    }
    return res.data as PickApiResponse;
  }

  public static async pick(action: string, currentRank: number): Promise<PickApiResponse> {
    const body = {
      action: action,
    };
    const res = await ApiClient.post(ApiRoute.PICK, body);
    if (res.useMock) {
      // Actually evaluate the guess based on card comparison
      return this.generateMockPickResponse(action, currentRank);
    }
    return res.data as PickApiResponse;
  }

  public static async cashout(): Promise<CashoutApiResponse> {
    const res = await ApiClient.post(ApiRoute.CASHOUT, {});
    if (res.useMock) {
      const totalWin = this.mockBetAmount * this.mockMultiplier;
      GameData.instance.totalMoney += totalWin;

      const response: CashoutApiResponse = {
        data: {
          ...mockCashoutResponse.data,
          multiplier: this.mockMultiplier,
          total_win: totalWin,
        }
      };

      // Reset mock state
      this.mockMultiplier = 1.0;
      this.mockBetAmount = 0;

      return response;
    }
    return res.data as CashoutApiResponse;
  }

  public static async result(): Promise<ResultApiResponse> {
    const res = await ApiClient.post(ApiRoute.RESULT, {});
    if (res.useMock) {
      return mockResultResponse;
    }
    return res.data as ResultApiResponse;
  }

  public static async history(page: number = 1): Promise<HistoryApiResponse> {
    const res = await ApiClient.post(ApiRoute.HISTORY, { page });
    if (res.useMock) {
      return mockHistoryResponse;
    }
    return res.data as HistoryApiResponse;
  }

  public static async historyDetail(txId: string): Promise<HistoryDetailApiResponse> {
    const res = await ApiClient.post(`${ApiRoute.HISTORY}/${txId}`, {});
    if (res.useMock) {
      return mockHistoryDetailResponse;
    }
    return res.data as HistoryDetailApiResponse;
  }

  // --- Mock Helpers ---

  private static generateMockPickResponse(action: string, currentRank: number): PickApiResponse {
    const previousRank = currentRank; // Use the actual displayed card rank from UI
    const newRank = this.randomRank();
    const newSuit = this.randomSuit();

    // Evaluate win/lose based on action and card comparison
    // Card order: A(1) < 2 < 3 < ... < Q(12) < K(13)
    let isWin = false;

    switch (action) {
      case "skip":
        // Skip always succeeds, just changes the card
        isWin = true;
        break;

      case "higher":
        // Higher or equal (matches backend behavior)
        isWin = newRank >= previousRank;
        break;

      case "lower":
        // Lower or equal (matches backend behavior)
        isWin = newRank <= previousRank;
        break;

      default:
        console.warn(`[Mock] Unknown action: ${action}`);
        isWin = false;
    }

    const endRound = !isWin;

    // Update current rank for next comparison
    this.mockCurrentRank = newRank;

    // Increase multiplier on win (not on skip or loss)
    if (isWin && action !== "skip") {
      this.mockMultiplier *= (1.0 + Math.random() * 0.5); // Random 1.0x - 1.5x increase
    }

    return {
      data: {
        pick: 1,
        rank: newRank,
        suit: newSuit,
        history_cards: mockPickResponse.data.history_cards,
        chance_up: this.calculateChanceUp(newRank),
        chance_down: this.calculateChanceDown(newRank),
        amount: this.mockBetAmount,
        multiplier: parseFloat(this.mockMultiplier.toFixed(2)),
        total_win: parseFloat((this.mockBetAmount * this.mockMultiplier).toFixed(2)),
        end_round: endRound,
      }
    };
  }

  private static randomRank(): number {
    return Math.floor(Math.random() * 13) + 1; // 1-13 (A-K)
  }

  private static randomSuit(): number {
    return Math.floor(Math.random() * 4) + 1; // 1-4 (diamond, club, heart, spade)
  }

  private static calculateChanceUp(rank: number): number {
    // Cards higher than current rank / 13 possible cards
    // K (13) is highest, so 0 cards above it
    const cardsAbove = 13 - rank; // Cards strictly above
    return parseFloat(((cardsAbove / 13) * 100).toFixed(2));
  }

  private static calculateChanceDown(rank: number): number {
    // Cards lower than current rank / 13 possible cards
    // A (1) is lowest, so 0 cards below it
    const cardsBelow = rank - 1; // Cards strictly below
    return parseFloat(((cardsBelow / 13) * 100).toFixed(2));
  }
}


