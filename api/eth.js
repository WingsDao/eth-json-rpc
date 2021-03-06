/**
 * eth management api.
 *
 * @module api/eth
 */

'use strict';

const ethereumTx = require('ethereumjs-tx');
const utils      = require('../lib/helpers');

module.exports = exports = Eth;

/**
 * Default gas limit.
 *
 * @type {String}
 */
const DEFAULT_GAS_LIMIT = exports.DEFAULT_GAS_LIMIT = '0x6691b7';

/**
 * Initiate Eth object.
 *
 * @param {EthRpc} command Command object.
 * @class
 */
function Eth(command) {
    if (!new.target) {
        return new Eth(command);
    }

    Object.getOwnPropertyNames(command).forEach(key => Object.defineProperty(this, key, {value: command[key]}));
}

/**
 * Call contract method.
 * @method eth_call
 *
 * @param  {String}   methodSignature        Method signature to call.
 * @param  {String}   to                     Address of receiver of call.
 * @param  {Object[]} [args=[]]              Arguments to pass with a call.
 * @param  {String}   [blockNumber='latest'] Hexadecimal block number with 0x prefix.
 * @return {Promise<String>}                 ETH RPC response result.
 */
Eth.prototype.call = async function call(methodSignature, to, args=[], blockNumber='latest') {
    if (blockNumber !== 'latest' && !utils.isHex(blockNumber)) {
        throw `Expected hex, got: ${blockNumber} (type ${typeof(blockNumber)})`;
    }

    const data = utils.encodeTxData(methodSignature, args);

    // make raw rpc call
    return this.rpc('eth_call', [{to: to, data: data}, blockNumber]);
};

/**
 * Create transaction object, sign transaction, serialize transaction, send transaction.
 * @method eth_sendRawTransaction
 *
 * @param  {String}        methodSignature Method signature to call.
 * @param  {String}        to              Address of receiver of call.
 * @param  {Object[]}      [args=[]]       Arguments to send.
 * @param  {String|Buffer} privateKey      Private key to sign transaction.
 * @param  {String}        nonce           Sender nonce.
 * @param  {String}        value           Value to send.
 * @param  {String}        gas             Gas limit.
 * @param  {String}        gasPrice        Gas price.
 * @param  {String}        data            Transaction data.
 * @return {Promise<String>}               Transaction hash.
 *
 * @example
 * const transactionHash = await ethRpc.eth.transaction('mint(uint256)', CONTRACT_ADDRESS, [100], PRIVATE_KEY);
 */
Eth.prototype.transaction = async function transaction(methodSignature, to, args=[], privateKey, nonce, value, gas, gasPrice, data) {
    data = data || utils.encodeTxData(methodSignature, args);

    if (!Buffer.isBuffer(privateKey)) {
        privateKey = Buffer.from(privateKey, 'hex');
    }

    [nonce, gasPrice] = await Promise.all([
        nonce    || (await this.getTransactionCount(utils.privateToAddress(privateKey))),
        gasPrice || (await this.gasPrice())
    ]);

    const tx = new ethereumTx({
        to,
        data,
        nonce,
        gas: gas || DEFAULT_GAS_LIMIT,
        gasPrice,
        value: value || '0x'
    });

    tx.sign(privateKey);

    return this.rpc('eth_sendRawTransaction', [tx.serialize()]);
};

/**
 * Get gas price.
 * @method eth_gasPrice
 *
 * @return {Promise<String>} Price in wei per gas.
 */
Eth.prototype.gasPrice = function gasPrice() {
    return this.rpc('eth_gasPrice', []);
};

/**
 * Get code at address.
 * @method eth_getCode
 *
 * @param  {String} address  Ethereum address.
 * @return {Promise<String>} Code from the given address.
 */
Eth.prototype.getCode = async function getCode(address) {
    return this.rpc('eth_getCode', [address, 'latest']);
};

/**
 * Get transaction receipt.
 * @method eth_getTransactionReceipt
 *
 * @param  {String} transactionHash Transaction hash.
 * @return {Promise<String>}
 */
Eth.prototype.getTransactionReceipt = function getTransactionReceipt(transactionHash) {
    return this.rpc('eth_getTransactionReceipt', [transactionHash]);
};

/**
 * Get number of transactions the address sent.
 * @method eth_getTransactionCount
 *
 * @param  {String} address
 * @param  {String} [bn='latest'] Block number. Hexadecimal string padded with 0x.
 * @return {Promise<String>}
 */
Eth.prototype.getTransactionCount = function getTransactionCount(address, bn='latest') {
    return this.rpc('eth_getTransactionCount', [address, bn]);
};

/**
 * Get number of the latest block.
 * @method eth_blockNumber
 *
 * @return {Promise<Number>} Current block number.
 */
Eth.prototype.blockNumber = function blockNumber() {
    return this.rpc('eth_blockNumber', []).then(parseInt16);
};

/**
 * Get block by number.
 * @method eth_getBlockByNumber
 *
 * @param  {Number} blockNumber Block number.
 * @return {Promise<Object>}    Block.
 */
Eth.prototype.getBlock = function getBlock(blockNumber) {
    return this.rpc('eth_getBlockByNumber', ['0x' + blockNumber.toString(16), true])
        .then(block => {
            block.number    = parseInt16(block.number);
            block.timestamp = parseInt16(block.timestamp);
            return block;
        });
};

/**
 * Get logs from blocks.
 * @method eth_getlogs
 *
 * @param  {Number} fromBlock  Number of first block.
 * @param  {Number} toBlock    Number of last block.
 * @return {Promise<Object[]>} Logs.
 */
Eth.prototype.getLogs = function getLogs(fromBlock, toBlock) {
    return this.rpc('eth_getLogs', [formatLogOptions(fromBlock, toBlock)]);
};

/**
 * Get blocks with logs in a batch RPC request.
 * @method eth_getBlockByNumber
 * @method eth_getLogs
 *
 * @param  {Number} fromBlock  Number of first block.
 * @param  {Number} toBlock    Number of last block.
 * @return {Promise<Object[]>} Blocks and logs.
 */
Eth.prototype.getBlocks = async function getBlocks(fromBlock, toBlock) {
    let batch = [];

    for (let i = fromBlock; i < toBlock; i++) {
        batch.push(this.client.request('eth_getBlockByNumber', ['0x' + i.toString(16), true], undefined, false));
    }

    const options = formatLogOptions(fromBlock, toBlock - 1);

    batch.push(this.client.request('eth_getLogs', [options], undefined, false));

    const responses = await this.request(batch);

    const blocks = responses.slice(0, -1).map(res => res.result).map(block => {
        return Object.assign(block, {
            number:    parseInt16(block.number),
            timestamp: parseInt16(block.timestamp)
        });
    });

    const logs = responses[responses.length-1].result;

    logs.forEach(log => {
        const logBlockNumber = parseInt16(log.blockNumber);
        const index          = logBlockNumber - fromBlock;
        const block          = blocks[index];

        if (log.blockHash !== block.hash) {
            throw `Error during fetch of logs. Log block hash (${log.blockHash}) differs from block hash (${block.hash})`;
        }

        return block.logs
            ? block.logs.push(log)
            : block.logs = [...[log]];
    });

    return blocks;
};

/**
 * Get blocks with logs in a batch RPC request with optional consistency.
 * @method eth_getBlockByNumber
 * @method eth_getLogs
 *
 * @param  {Number[]} blockNumbers Array of block numbers to index.
 * @return {Object[]}              Blocks and logs.
 */
Eth.prototype.getBlocksFromArray = async function getBlocksFromArray(blockNumbers) {
    let batch = [];

    for (let bn of blockNumbers) {
        batch.push(this.client.request('eth_getBlockByNumber', ['0x' + bn.toString(16), true], undefined, false));
        batch.push(this.client.request('eth_getLogs', [formatLogOptions(bn, bn)], undefined, false));
    }

    let blocks = [];

    const responses = await this.request(batch);

    for (let i = 0; i < responses.length - 1; i += 2) {
        const block = responses[i].result;

        blocks.push(Object.assign(block, {
            number:    parseInt16(block.number),
            timestamp: parseInt16(block.timestamp),
            logs:      responses[i + 1].result
        }));
    }

    return blocks;
};

/**
 * Format log options.
 *
 * @param  {Number} fromBlock Number of first block.
 * @param  {Number} toBlock   Number of last block.
 * @return {Object}           Options.
 */
function formatLogOptions(fromBlock, toBlock) {
    return {
        fromBlock: '0x' + fromBlock.toString(16),
        toBlock:   '0x' + toBlock.toString(16)
    };
}

/**
 * Parse hexaadecimal integer.
 *
 * @param  {Number} int
 * @return {Number}
 */
function parseInt16(int) {
    return parseInt(int, 16);
}
