/* eslint-disable @typescript-eslint/no-explicit-any */
import BlankProvider from './provider/BlankProvider';
import { JSONRPCMethod } from '@blank/background/utils/types/ethereum';

// Global

type This = typeof globalThis;

export interface InjectedWindow extends This {
    ethereum: BlankProvider;
    web3: { currentProvider: BlankProvider };
}

// Provider interface
export interface EthereumProvider {
    readonly isBlank: true;

    // Metamask compatibility
    readonly isMetaMask: boolean;

    chainId: string | null;
    selectedAddress: string | null;
    networkVersion: string | null;

    // Methods
    isConnected(): boolean;
    request(args: RequestArguments): Promise<unknown>;

    // Deprecated
    send(request: JSONRPCRequest): JSONRPCResponse;
    send(request: JSONRPCRequest[]): JSONRPCResponse[];
    send(request: JSONRPCRequest, callback: Callback<JSONRPCResponse>): void;
    send(
        request: JSONRPCRequest[],
        callback: Callback<JSONRPCResponse[]>
    ): void;
    send<T = any>(method: string, params?: any[] | any): Promise<T>;

    sendAsync(
        request: JSONRPCRequest,
        callback: Callback<JSONRPCResponse>
    ): void;
    sendAsync(
        request: JSONRPCRequest[],
        callback: Callback<JSONRPCResponse[]>
    ): void;
    sendAsync(
        request: JSONRPCRequest | JSONRPCRequest[],
        callback: Callback<JSONRPCResponse> | Callback<JSONRPCResponse[]>
    ): void;

    enable(): Promise<string[]>;
}

// Deprecated methods

export interface JSONRPCRequest<T = any[]> {
    jsonrpc: '2.0';
    id: number;
    method: JSONRPCMethod;
    params: T;
}

export interface JSONRPCResponse<T = any, U = any> {
    jsonrpc: '2.0';
    id: number;
    result?: T;
    error?: {
        code: number;
        message: string;
        data?: U;
    } | null;
}

export type Callback<T> = (err: Error | null, result: T | null) => void;

// Provider types

export interface ProviderSetupData {
    accounts: string[];
    chainId: string;
    networkVersion: string;
}

export interface ProviderRpcError extends Error {
    code: number;
    data?: unknown;
}

export interface RequestArguments {
    readonly method: JSONRPCMethod;
    readonly params?: readonly unknown[] | Record<string, unknown>;
}

export interface ProviderMessage {
    readonly type: string;
    readonly data: unknown;
}

export interface EthSubscription extends ProviderMessage {
    readonly type: 'eth_subscription';
    readonly data: {
        readonly subscription: string;
        readonly result: unknown;
    };
}

// Provider events

export enum ProviderEvents {
    accountsChanged = 'accountsChanged',
    chainChanged = 'chainChanged',
    connect = 'connect',
    disconnect = 'disconnect',
    message = 'message',
}

export interface ProviderConnectInfo {
    readonly chainId: string;
}

export interface ChainChangedInfo {
    chainId: string;
    networkVersion: string;
}

// Site Metadata
export interface SiteMetadata {
    iconURL: string | null;
    name: string;
}
