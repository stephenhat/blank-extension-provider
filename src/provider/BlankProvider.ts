/* eslint-disable @typescript-eslint/no-explicit-any */
import {
    Callback,
    RequestArguments,
    JSONRPCRequest,
    JSONRPCResponse,
    ProviderConnectInfo,
    ProviderMessage,
    ProviderRpcError,
    ProviderEvents,
    EthereumProvider,
    ChainChangedInfo,
} from '../types';
import {
    ExternalEventSubscription,
    Handlers,
    MessageTypes,
    Messages,
    RequestTypes,
    ResponseTypes,
    SubscriptionMessageTypes,
    TransportResponseMessage,
    EXTERNAL,
    Origin,
    WindowTransportRequestMessage,
} from '@blank/background/utils/types/communication';
import SafeEventEmitter from '@metamask/safe-event-emitter';
import { ethErrors } from 'eth-rpc-errors';
import { getSiteMetadata, isCompatible } from '../utils/site';
import { JSONRPCMethod } from '@blank/background/utils/types/ethereum';
import { validateError } from '../utils/errors';
import log from 'loglevel';

interface BlankProviderState {
    accounts: string[];
    isConnected: boolean;
}

/**
 * Blank Provider
 *
 */
export default class BlankProvider
    extends SafeEventEmitter
    implements EthereumProvider
{
    public readonly isBlank: true;
    public readonly isMetaMask: boolean;
    public chainId: string | null;
    public selectedAddress: string | null;
    public networkVersion: string | null;
    private _state: BlankProviderState;
    private _handlers: Handlers;
    private _requestId: number;
    private _metamask: {
        isEnabled(): boolean;
        isApproved(): Promise<boolean>;
        isUnlocked(): Promise<boolean>;
    };

    constructor() {
        super();

        this._state = {
            accounts: [],
            isConnected: false,
        };

        this.chainId = null;
        this.selectedAddress = null;
        this.networkVersion = null;

        this.isBlank = true;

        this._handlers = {};
        this._requestId = 0;

        // Metamask compatibility
        this.isMetaMask = !isCompatible();
        this._metamask = {
            isEnabled: () => true,
            isApproved: async () => true,
            isUnlocked: async () => true,
        };

        // Bind non arrow functions
        this.send = this.send.bind(this);
        this.sendAsync = this.sendAsync.bind(this);

        // Setup provider
        this._setupProvider();

        // Subscribe to state updates
        this._eventSubscription(this._eventHandler);

        // Set provider metadata
        this._setMetadata();
    }

    /**
     * Public method to check if the provider is connected
     *
     */
    public isConnected = (): boolean => {
        return this._state.isConnected;
    };

    /**
     * Public request method
     *
     * @param args Request arguments
     * @returns Request response
     */
    public request = async (args: RequestArguments): Promise<unknown> => {
        if (!args || typeof args !== 'object' || Array.isArray(args)) {
            throw ethErrors.rpc.invalidRequest({
                message: 'Expected a single, non-array, object argument.',
                data: args,
            });
        }

        const { method, params } = args;

        if (typeof method !== 'string' || method.length === 0) {
            throw ethErrors.rpc.invalidRequest({
                message: "'method' property must be a non-empty string.",
                data: args,
            });
        }

        if (
            params !== undefined &&
            !Array.isArray(params) &&
            (typeof params !== 'object' || params === null)
        ) {
            throw ethErrors.rpc.invalidRequest({
                message:
                    "'params' property must be an object or array if provided.",
                data: args,
            });
        }

        return this._postMessage(Messages.EXTERNAL.REQUEST, args);
    };

    /**
     * Response handler
     *
     */
    public handleResponse = <TMessageType extends MessageTypes>(
        data: TransportResponseMessage<TMessageType>
    ): void => {
        const handler = this._handlers[data.id];

        if (!handler) {
            log.error('Unknown response', data);

            return;
        }

        if (!handler.subscriber) {
            delete this._handlers[data.id];
        }

        if (data.subscription) {
            (handler.subscriber as (data: any) => void)(data.subscription);
        } else if (data.error) {
            const err = validateError(data.error);
            handler.reject(err);
        } else {
            handler.resolve(data.response);
        }
    };

    /* ----------------------------------------------------------------------------- */
    /* Deprecated request methods
    /* ----------------------------------------------------------------------------- */

    /**
     * Deprecated send method
     *
     */
    public send(request: JSONRPCRequest): JSONRPCResponse;
    public send(request: JSONRPCRequest[]): JSONRPCResponse[];
    public send(
        request: JSONRPCRequest,
        callback: Callback<JSONRPCResponse>
    ): void;
    public send(
        request: JSONRPCRequest[],
        callback: Callback<JSONRPCResponse[]>
    ): void;
    public send<T = any>(method: string, params?: any[] | any): Promise<T>;
    public send(
        requestOrMethod: JSONRPCRequest | JSONRPCRequest[] | string,
        callbackOrParams?:
            | Callback<JSONRPCResponse>
            | Callback<JSONRPCResponse[]>
            | any[]
            | any
    ): JSONRPCResponse | JSONRPCResponse[] | void | Promise<any> {
        log.warn(
            "Blank Wallet: 'ethereum.send(...)' is deprecated and may be removed in the future. Please use 'ethereum.request(...)' instead.\nFor more information, see: https://eips.ethereum.org/EIPS/eip-1193"
        );

        // send<T>(method, params): Promise<T>
        if (typeof requestOrMethod === 'string') {
            const method = requestOrMethod as JSONRPCMethod;
            const params = Array.isArray(callbackOrParams)
                ? callbackOrParams
                : callbackOrParams !== undefined
                ? [callbackOrParams]
                : [];
            const request: RequestArguments = {
                method,
                params,
            };
            const response = this._postMessage(
                Messages.EXTERNAL.REQUEST,
                request
            );

            return response;
        }

        // send(JSONRPCRequest | JSONRPCRequest[], callback): void
        if (typeof callbackOrParams === 'function') {
            const request = requestOrMethod as any;
            const callback = callbackOrParams as any;
            return this.sendAsync(request, callback);
        }

        // send(JSONRPCRequest[]): JSONRPCResponse[]
        if (Array.isArray(requestOrMethod)) {
            const requests = requestOrMethod;
            return requests.map((r) => this._sendJSONRPCRequest(r));
        }

        // send(JSONRPCRequest): JSONRPCResponse
        const req = requestOrMethod as JSONRPCRequest;
        return this._sendJSONRPCRequest(req);
    }

    /**
     * Asynchronous send method
     *
     */
    public sendAsync(
        request: JSONRPCRequest,
        callback: Callback<JSONRPCResponse>
    ): void;
    public sendAsync(
        request: JSONRPCRequest[],
        callback: Callback<JSONRPCResponse[]>
    ): void;
    public sendAsync(
        request: JSONRPCRequest | JSONRPCRequest[],
        callback: Callback<JSONRPCResponse> | Callback<JSONRPCResponse[]>
    ): void {
        if (typeof callback !== 'function') {
            throw ethErrors.rpc.invalidRequest({
                message: 'A callback is required',
            });
        }

        // send(JSONRPCRequest[], callback): void
        if (Array.isArray(request)) {
            const arrayCb = callback as Callback<JSONRPCResponse[]>;
            this._sendMultipleRequestsAsync(request)
                .then((responses) => arrayCb(null, responses))
                .catch((err) => arrayCb(err, null));
            return;
        }

        // send(JSONRPCRequest, callback): void
        const cb = callback as Callback<JSONRPCResponse>;
        this._sendRequestAsync(request)
            .then((response) => cb(null, response))
            .catch((err) => cb(err, null));
    }

    public enable = async (): Promise<string[]> => {
        log.warn(
            "Blank Wallet: 'ethereum.enable(...)' is deprecated and may be removed in the future. See: https://eips.ethereum.org/EIPS/eip-1193"
        );
        const accounts = (await this._postMessage(Messages.EXTERNAL.REQUEST, {
            method: JSONRPCMethod.eth_requestAccounts,
        })) as string[];

        return accounts;
    };

    /* ----------------------------------------------------------------------------- */
    /* Provider setup
    /* ----------------------------------------------------------------------------- */

    /**
     * Provider setup
     *
     */
    private _setupProvider = async () => {
        const { accounts, chainId, networkVersion } = await this._postMessage(
            Messages.EXTERNAL.SETUP_PROVIDER
        );

        this.networkVersion = networkVersion;
        this.chainId = chainId;

        this._connect({ chainId });
        this._accountsChanged(accounts);
    };

    /**
     * Sends site metadata to the background
     *
     */
    private _setMetadata = async () => {
        if (
            document.readyState === 'complete' ||
            document.readyState === 'interactive'
        ) {
            const siteMetadata = await getSiteMetadata();

            this._postMessage(Messages.EXTERNAL.SET_METADATA, {
                siteMetadata,
            });
        } else {
            const domContentLoadedHandler = async () => {
                const siteMetadata = await getSiteMetadata();

                this._postMessage(Messages.EXTERNAL.SET_METADATA, {
                    siteMetadata,
                });

                window.removeEventListener(
                    'DOMContentLoaded',
                    domContentLoadedHandler
                );
            };

            window.addEventListener(
                'DOMContentLoaded',
                domContentLoadedHandler
            );
        }
    };

    /**
     * Subscribes to events updates
     *
     * @param cb update handler
     */
    private _eventSubscription = async (
        cb: (state: ExternalEventSubscription) => void
    ): Promise<boolean> => {
        return this._postMessage(
            Messages.EXTERNAL.EVENT_SUBSCRIPTION,
            undefined,
            cb
        );
    };

    /* ----------------------------------------------------------------------------- */
    /* Requests utils
    /* ----------------------------------------------------------------------------- */

    /**
     * Post a message using the window object, to be listened by the content script
     *
     * @param message External method to use
     * @param request Request parameters
     * @param subscriber Subscription callback
     * @returns Promise with the response
     */
    private _postMessage = <TMessageType extends EXTERNAL>(
        message: TMessageType,
        request?: RequestTypes[TMessageType],
        subscriber?: (data: SubscriptionMessageTypes[TMessageType]) => void
    ): Promise<ResponseTypes[TMessageType]> => {
        return new Promise((resolve, reject): void => {
            const id = `${Date.now()}.${++this._requestId}`;

            this._handlers[id] = { reject, resolve, subscriber };

            window.postMessage(
                {
                    id,
                    message,
                    origin: Origin.PROVIDER,
                    request: request || {},
                } as WindowTransportRequestMessage,
                window.location.href
            );
        });
    };

    /**
     * Synchronous RPC request
     *
     */
    private _sendJSONRPCRequest = (
        request: JSONRPCRequest
    ): JSONRPCResponse => {
        const response: JSONRPCResponse = {
            jsonrpc: '2.0',
            id: request.id,
        };

        response.result = this._handleSynchronousMethods(request);

        if (response.result === undefined) {
            throw new Error(
                `Please provide a callback parameter to call ${request.method} ` +
                    'asynchronously.'
            );
        }

        return response;
    };

    private _sendMultipleRequestsAsync = (
        requests: JSONRPCRequest[]
    ): Promise<JSONRPCResponse[]> => {
        return Promise.all(requests.map((r) => this._sendRequestAsync(r)));
    };

    private _sendRequestAsync = (
        request: JSONRPCRequest
    ): Promise<JSONRPCResponse> => {
        return new Promise<JSONRPCResponse>((resolve, reject) => {
            this._handleAsynchronousMethods(request)
                .then((res) => {
                    resolve(res);
                })
                .catch((err) => reject(err));
        });
    };

    /**
     * Synchronous methods handler
     *
     */
    private _handleSynchronousMethods = (request: JSONRPCRequest) => {
        const { method } = request;

        switch (method) {
            case JSONRPCMethod.eth_accounts:
                return this.selectedAddress ? [this.selectedAddress] : [];
            case JSONRPCMethod.eth_coinbase:
                return this.selectedAddress || null;
            case JSONRPCMethod.net_version:
                return this.networkVersion || null;
            default:
                return undefined;
        }
    };

    /**
     * Asynchronous methods handler
     *
     */
    private _handleAsynchronousMethods = async (
        request: JSONRPCRequest
    ): Promise<JSONRPCResponse> => {
        const response: JSONRPCResponse = {
            jsonrpc: '2.0',
            id: request.id,
        };

        response.result = await this._postMessage(Messages.EXTERNAL.REQUEST, {
            method: request.method,
            params: request.params,
        });

        return response;
    };

    /* ----------------------------------------------------------------------------- */
    /* Events
    /* ----------------------------------------------------------------------------- */

    private _eventHandler = ({
        eventName,
        payload,
    }: ExternalEventSubscription): void => {
        switch (eventName) {
            case ProviderEvents.connect:
                this._connect(payload);
                break;
            case ProviderEvents.disconnect:
                this._disconnect(payload);
                break;
            case ProviderEvents.chainChanged:
                this._chainChanged(payload);
                break;
            case ProviderEvents.accountsChanged:
                this._accountsChanged(payload);
                break;
            default:
                break;
        }
    };

    private _connect = (connectInfo: ProviderConnectInfo) => {
        this._state.isConnected = true;
        this.emit(ProviderEvents.connect, connectInfo);
    };

    private _disconnect = (
        error: ProviderRpcError = ethErrors.provider.disconnected()
    ) => {
        this.emit(ProviderEvents.disconnect, error);
    };

    private _chainChanged = ({ chainId, networkVersion }: ChainChangedInfo) => {
        if (chainId !== this.chainId) {
            this.chainId = chainId;
            this.networkVersion = networkVersion;

            this.emit(ProviderEvents.chainChanged, chainId);
        }
    };

    private _accountsChanged = async (accounts: string[]) => {
        if (
            accounts.length !== this._state.accounts.length ||
            !accounts.every((val, index) => val === this._state.accounts[index])
        ) {
            this._state.accounts = accounts;

            if (this.selectedAddress !== accounts[0]) {
                this.selectedAddress = accounts[0] || null;
            }

            this.emit(ProviderEvents.accountsChanged, accounts);
        }
    };

    private _sendMessageToConsumer = (message: ProviderMessage) => {
        window.postMessage(message, window.location.href);
    };
}
