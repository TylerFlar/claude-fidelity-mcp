export interface FidelityConfig {
  headless: boolean;
  sessionDir: string;
  sessionTitle?: string;
  debug: boolean;
  timeout: number;
}

export interface Stock {
  ticker: string;
  description: string;
  quantity: number;
  lastPrice: number;
  lastPriceChange: number;
  currentValue: number;
}

export interface Account {
  accountNumber: string;
  accountName: string;
  nickname: string;
  balance: number;
  withdrawalBalance: number;
  stocks: Stock[];
}

export type OrderAction = "buy" | "sell";
export type OrderType = "market" | "limit";

export interface OrderRequest {
  accountNumber: string;
  symbol: string;
  action: OrderAction;
  quantity: number;
  orderType?: OrderType;
  limitPrice?: number;
  dryRun?: boolean;
}

export interface OrderResult {
  success: boolean;
  message: string;
  orderDetails?: {
    account: string;
    symbol: string;
    action: OrderAction;
    quantity: number;
    price: number;
    orderType: OrderType;
  };
}

export interface QuoteResult {
  symbol: string;
  lastPrice: number;
  extendedHoursPrice?: number;
  isExtendedHours: boolean;
}

export interface TransferRequest {
  fromAccount: string;
  toAccount: string;
  amount: number;
}

export interface TransferResult {
  success: boolean;
  message: string;
}

export interface LoginResult {
  success: boolean;
  needsSms2FA: boolean;
  message: string;
}
