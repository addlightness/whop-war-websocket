"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
var ws_1 = require("ws");
// In-memory storage
var games = new Map();
var queue = new Set();
var playerConnections = new Map();
var joinCodes = new Map(); // code -> gameId
// Card utilities (copied from gameContext)
function createCard(name) {
    var parts = name.replace('.png', '').split('_');
    var rankStr = parts[0];
    var suit = parts[2];
    var rank;
    if (rankStr === 'ace')
        rank = 14;
    else if (rankStr === 'king')
        rank = 13;
    else if (rankStr === 'queen')
        rank = 12;
    else if (rankStr === 'jack')
        rank = 11;
    else
        rank = parseInt(rankStr);
    return { suit: suit, rank: rank, name: name };
}
function shuffleDeck(deck) {
    var _a;
    var shuffled = __spreadArray([], deck, true);
    for (var i = shuffled.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        _a = [shuffled[j], shuffled[i]], shuffled[i] = _a[0], shuffled[j] = _a[1];
    }
    return shuffled;
}
function createDeck() {
    var suits = ['hearts', 'diamonds', 'clubs', 'spades'];
    var ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'jack', 'queen', 'king', 'ace'];
    var deck = [];
    suits.forEach(function (suit) {
        ranks.forEach(function (rank) {
            deck.push(createCard("".concat(rank, "_of_").concat(suit)));
        });
    });
    return shuffleDeck(deck);
}
function generateJoinCode() {
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    var result = '';
    for (var i = 0; i < 6; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}
function formatCardName(name) {
    return name.replace(/_/g, ' ').replace(/\b\w/g, function (l) { return l.toUpperCase(); });
}
function formatCardRank(name) {
    var parts = name.replace('.png', '').split('_');
    var rankStr = parts[0];
    if (rankStr === 'ace')
        return 'Aces';
    else if (rankStr === 'king')
        return 'Kings';
    else if (rankStr === 'queen')
        return 'Queens';
    else if (rankStr === 'jack')
        return 'Jacks';
    else
        return "".concat(rankStr, "s");
}
// Game logic
function startGame(player1, player2, joinCode) {
    var deck = createDeck();
    var shuffledDeck = shuffleDeck(deck);
    var game = {
        id: "game_".concat(Date.now(), "_").concat(Math.random().toString(36).substr(2, 9)),
        player1: player1,
        player2: player2,
        player1Deck: shuffledDeck.slice(0, 26),
        player2Deck: shuffledDeck.slice(26),
        player1Card: null,
        player2Card: null,
        player1WarCards: [],
        player2WarCards: [],
        gameStatus: 'playing',
        currentPlayer: 'player1',
        winner: null,
        message: 'Game started! Player 1 goes first.',
        joinCode: joinCode
    };
    games.set(game.id, game);
    player1.gameId = game.id;
    player2.gameId = game.id;
    if (joinCode) {
        joinCodes.set(joinCode, game.id);
    }
    return game;
}
function processGameAction(game, action, playerId) {
    if (game.gameStatus === 'finished')
        return game;
    // Check if it's the player's turn
    var isPlayer1 = playerId === game.player1.id;
    var isPlayer2 = playerId === game.player2.id;
    if (action === 'draw_card') {
        if (game.gameStatus === 'playing') {
            if ((isPlayer1 && game.currentPlayer === 'player1') || (isPlayer2 && game.currentPlayer === 'player2')) {
                return handleDrawCards(game, isPlayer1);
            }
        }
        else if (game.gameStatus === 'war') {
            if ((isPlayer1 && game.currentPlayer === 'player1') || (isPlayer2 && game.currentPlayer === 'player2')) {
                return handleResolveWar(game, isPlayer1);
            }
        }
    }
    return game;
}
function handleDrawCards(game, isPlayer1) {
    var playerDeck = isPlayer1 ? game.player1Deck : game.player2Deck;
    var opponentDeck = isPlayer1 ? game.player2Deck : game.player1Deck;
    if (playerDeck.length === 0 || opponentDeck.length === 0) {
        var winner = playerDeck.length > 0 ? (isPlayer1 ? 'player1' : 'player2') : (isPlayer1 ? 'player2' : 'player1');
        return __assign(__assign({}, game), { gameStatus: 'finished', winner: winner, message: "".concat(isPlayer1 ? game.player1.name : game.player2.name, " wins!") });
    }
    var playerCard = playerDeck[0];
    var opponentCard = opponentDeck[0];
    var newPlayerDeck = playerDeck.slice(1);
    var newOpponentDeck = opponentDeck.slice(1);
    if (playerCard.rank > opponentCard.rank) {
        // Player wins
        var updatedGame = __assign(__assign({}, game), { player1Deck: isPlayer1 ? __spreadArray(__spreadArray([], newPlayerDeck, true), [playerCard, opponentCard], false) : newPlayerDeck, player2Deck: isPlayer1 ? newOpponentDeck : __spreadArray(__spreadArray([], newOpponentDeck, true), [playerCard, opponentCard], false), player1Card: isPlayer1 ? playerCard : opponentCard, player2Card: isPlayer1 ? opponentCard : playerCard, message: "".concat(isPlayer1 ? game.player1.name : game.player2.name, " wins! ").concat(formatCardName(playerCard.name), " beats ").concat(formatCardName(opponentCard.name)), currentPlayer: (isPlayer1 ? 'player1' : 'player2') });
        return updatedGame;
    }
    else if (opponentCard.rank > playerCard.rank) {
        // Opponent wins
        var updatedGame = __assign(__assign({}, game), { player1Deck: isPlayer1 ? newPlayerDeck : __spreadArray(__spreadArray([], newPlayerDeck, true), [playerCard, opponentCard], false), player2Deck: isPlayer1 ? __spreadArray(__spreadArray([], newOpponentDeck, true), [playerCard, opponentCard], false) : newOpponentDeck, player1Card: isPlayer1 ? playerCard : opponentCard, player2Card: isPlayer1 ? opponentCard : playerCard, message: "".concat(isPlayer1 ? game.player2.name : game.player1.name, " wins! ").concat(formatCardName(opponentCard.name), " beats ").concat(formatCardName(playerCard.name)), currentPlayer: (isPlayer1 ? 'player2' : 'player1') });
        return updatedGame;
    }
    else {
        // War!
        var playerWarCards = newPlayerDeck.slice(0, 3);
        var opponentWarCards = newOpponentDeck.slice(0, 3);
        return __assign(__assign({}, game), { player1Deck: isPlayer1 ? newPlayerDeck.slice(3) : newPlayerDeck, player2Deck: isPlayer1 ? newOpponentDeck : newOpponentDeck.slice(3), player1Card: isPlayer1 ? playerCard : opponentCard, player2Card: isPlayer1 ? opponentCard : playerCard, player1WarCards: isPlayer1 ? playerWarCards : opponentWarCards, player2WarCards: isPlayer1 ? opponentWarCards : playerWarCards, gameStatus: 'war', message: "WAR! Both cards are ".concat(formatCardRank(playerCard.name), ". Click to resolve the war!"), currentPlayer: (isPlayer1 ? 'player1' : 'player2') });
    }
}
function handleResolveWar(game, isPlayer1) {
    var playerDeck = isPlayer1 ? game.player1Deck : game.player2Deck;
    var opponentDeck = isPlayer1 ? game.player2Deck : game.player1Deck;
    if (playerDeck.length < 1 || opponentDeck.length < 1) {
        var winner = playerDeck.length >= 1 ? (isPlayer1 ? 'player1' : 'player2') : (isPlayer1 ? 'player2' : 'player1');
        return __assign(__assign({}, game), { gameStatus: 'finished', winner: winner, message: "".concat(isPlayer1 ? game.player1.name : game.player2.name, " wins! Opponent ran out of cards during war!") });
    }
    var playerWarCard = playerDeck[0];
    var opponentWarCard = opponentDeck[0];
    var allWarCards = __spreadArray(__spreadArray(__spreadArray([
        game.player1Card,
        game.player2Card
    ], game.player1WarCards, true), game.player2WarCards, true), [
        playerWarCard,
        opponentWarCard,
    ], false);
    var newPlayerDeck = playerDeck.slice(1);
    var newOpponentDeck = opponentDeck.slice(1);
    if (playerWarCard.rank > opponentWarCard.rank) {
        // Player wins war
        return __assign(__assign({}, game), { player1Deck: isPlayer1 ? __spreadArray(__spreadArray([], newPlayerDeck, true), allWarCards, true) : newPlayerDeck, player2Deck: isPlayer1 ? newOpponentDeck : __spreadArray(__spreadArray([], newOpponentDeck, true), allWarCards, true), player1Card: isPlayer1 ? playerWarCard : opponentWarCard, player2Card: isPlayer1 ? opponentWarCard : playerWarCard, player1WarCards: [], player2WarCards: [], gameStatus: 'playing', message: "".concat(isPlayer1 ? game.player1.name : game.player2.name, " wins the war! ").concat(formatCardName(playerWarCard.name), " beats ").concat(formatCardName(opponentWarCard.name)), currentPlayer: (isPlayer1 ? 'player1' : 'player2') });
    }
    else if (opponentWarCard.rank > playerWarCard.rank) {
        // Opponent wins war
        return __assign(__assign({}, game), { player1Deck: isPlayer1 ? newPlayerDeck : __spreadArray(__spreadArray([], newPlayerDeck, true), allWarCards, true), player2Deck: isPlayer1 ? __spreadArray(__spreadArray([], newOpponentDeck, true), allWarCards, true) : newOpponentDeck, player1Card: isPlayer1 ? playerWarCard : opponentWarCard, player2Card: isPlayer1 ? opponentWarCard : playerWarCard, player1WarCards: [], player2WarCards: [], gameStatus: 'playing', message: "".concat(isPlayer1 ? game.player2.name : game.player1.name, " wins the war! ").concat(formatCardName(opponentWarCard.name), " beats ").concat(formatCardName(playerWarCard.name)), currentPlayer: (isPlayer1 ? 'player2' : 'player1') });
    }
    else {
        // Another war!
        var newPlayerWarCards = newPlayerDeck.slice(0, 3);
        var newOpponentWarCards = newOpponentDeck.slice(0, 3);
        return __assign(__assign({}, game), { player1Deck: isPlayer1 ? newPlayerDeck.slice(3) : newPlayerDeck, player2Deck: isPlayer1 ? newOpponentDeck : newOpponentDeck.slice(3), player1Card: isPlayer1 ? playerWarCard : opponentWarCard, player2Card: isPlayer1 ? opponentWarCard : playerWarCard, player1WarCards: __spreadArray(__spreadArray([
                game.player1Card
            ], game.player1WarCards, true), (isPlayer1 ? newPlayerWarCards : newOpponentWarCards), true), player2WarCards: __spreadArray(__spreadArray([
                game.player2Card
            ], game.player2WarCards, true), (isPlayer1 ? newOpponentWarCards : newPlayerWarCards), true), message: "Another WAR! Both cards are ".concat(formatCardRank(playerWarCard.name), ". Click to resolve the war."), currentPlayer: (isPlayer1 ? 'player1' : 'player2') });
    }
}
function broadcastToGame(game, message) {
    var gameData = {
        type: 'game_update',
        data: {
            gameId: game.id,
            player1Deck: game.player1Deck.length,
            player2Deck: game.player2Deck.length,
            player1Card: game.player1Card,
            player2Card: game.player2Card,
            player1WarCards: game.player1WarCards,
            player2WarCards: game.player2WarCards,
            gameStatus: game.gameStatus,
            currentPlayer: game.currentPlayer,
            winner: game.winner,
            message: game.message,
            player1Name: game.player1.name,
            player2Name: game.player2.name
        }
    };
    if (game.player1.ws.readyState === ws_1.WebSocket.OPEN) {
        game.player1.ws.send(JSON.stringify(gameData));
    }
    if (game.player2.ws.readyState === ws_1.WebSocket.OPEN) {
        game.player2.ws.send(JSON.stringify(gameData));
    }
}
function cleanupPlayer(playerId) {
    var player = playerConnections.get(playerId);
    if (player) {
        playerConnections.delete(playerId);
        queue.delete(playerId);
        // Find and cleanup any games this player was in
        for (var _i = 0, _a = Array.from(games.entries()); _i < _a.length; _i++) {
            var _b = _a[_i], gameId = _b[0], game = _b[1];
            if (game.player1.id === playerId || game.player2.id === playerId) {
                // Notify opponent about disconnection
                var opponent = game.player1.id === playerId ? game.player2 : game.player1;
                if (opponent.ws.readyState === ws_1.WebSocket.OPEN) {
                    opponent.ws.send(JSON.stringify({
                        type: 'opponent_disconnected',
                        data: { message: 'Your opponent has disconnected.' }
                    }));
                }
                // Clean up game
                games.delete(gameId);
                if (game.joinCode) {
                    joinCodes.delete(game.joinCode);
                }
                break;
            }
        }
    }
}
// WebSocket Server
var port = Number(process.env.PORT) || 3001;
var wss = new ws_1.WebSocketServer({
    port: port,
    host: '0.0.0.0'
});
wss.on('connection', function (ws, req) {
    console.log('New WebSocket connection');
    var playerId = null;
    ws.on('message', function (data) {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        try {
            var message = JSON.parse(data.toString());
            switch (message.type) {
                case 'ping':
                    ws.send(JSON.stringify({ type: 'pong' }));
                    break;
                case 'join_queue':
                    if (((_a = message.data) === null || _a === void 0 ? void 0 : _a.playerId) && ((_b = message.data) === null || _b === void 0 ? void 0 : _b.name)) {
                        playerId = message.data.playerId;
                        var player = {
                            id: message.data.playerId,
                            name: message.data.name,
                            ws: ws
                        };
                        playerConnections.set(message.data.playerId, ws);
                        // Check if there's someone in queue
                        if (queue.size > 0) {
                            var waitingPlayerId = queue.values().next().value;
                            if (waitingPlayerId) {
                                queue.delete(waitingPlayerId);
                                var waitingPlayer = playerConnections.get(waitingPlayerId);
                                if (waitingPlayer) {
                                    var waitingPlayerData = {
                                        id: waitingPlayerId,
                                        name: message.data.waitingPlayerName || 'Player',
                                        ws: waitingPlayer
                                    };
                                    var game = startGame(waitingPlayerData, player);
                                    broadcastToGame(game, null);
                                }
                            }
                        }
                        else {
                            queue.add(message.data.playerId);
                            ws.send(JSON.stringify({
                                type: 'queue_joined',
                                data: { message: 'Waiting for opponent...' }
                            }));
                        }
                    }
                    break;
                case 'create_game':
                    if (((_c = message.data) === null || _c === void 0 ? void 0 : _c.playerId) && ((_d = message.data) === null || _d === void 0 ? void 0 : _d.name)) {
                        playerId = message.data.playerId;
                        var player = {
                            id: message.data.playerId,
                            name: message.data.name,
                            ws: ws
                        };
                        playerConnections.set(message.data.playerId, ws);
                        var joinCode = generateJoinCode();
                        var game = startGame(player, player, joinCode);
                        game.gameStatus = 'waiting';
                        game.message = "Game created! Share code: ".concat(joinCode);
                        ws.send(JSON.stringify({
                            type: 'game_created',
                            data: { joinCode: joinCode, gameId: game.id }
                        }));
                    }
                    break;
                case 'join_game':
                    if (((_e = message.data) === null || _e === void 0 ? void 0 : _e.playerId) && ((_f = message.data) === null || _f === void 0 ? void 0 : _f.name) && ((_g = message.data) === null || _g === void 0 ? void 0 : _g.joinCode)) {
                        playerId = message.data.playerId;
                        var gameId = joinCodes.get(message.data.joinCode);
                        if (gameId && games.has(gameId)) {
                            var game = games.get(gameId);
                            if (game.gameStatus === 'waiting') {
                                var player = {
                                    id: message.data.playerId,
                                    name: message.data.name,
                                    ws: ws
                                };
                                playerConnections.set(message.data.playerId, ws);
                                game.player2 = player;
                                game.gameStatus = 'playing';
                                game.message = 'Game started! Player 1 goes first.';
                                // Update the games Map with the modified game
                                games.set(game.id, game);
                                broadcastToGame(game, null);
                            }
                            else {
                                ws.send(JSON.stringify({
                                    type: 'error',
                                    data: { message: 'Game is already full or in progress.' }
                                }));
                            }
                        }
                        else {
                            ws.send(JSON.stringify({
                                type: 'error',
                                data: { message: 'Invalid join code.' }
                            }));
                        }
                    }
                    break;
                case 'game_action':
                    if (playerId && ((_h = message.data) === null || _h === void 0 ? void 0 : _h.action)) {
                        var game = Array.from(games.values()).find(function (g) {
                            return g.player1.id === playerId || g.player2.id === playerId;
                        });
                        if (game) {
                            var updatedGame = processGameAction(game, message.data.action, playerId);
                            games.set(updatedGame.id, updatedGame);
                            broadcastToGame(updatedGame, null);
                        }
                    }
                    break;
            }
        }
        catch (error) {
            console.error('Error processing message:', error);
            ws.send(JSON.stringify({
                type: 'error',
                data: { message: 'Invalid message format.' }
            }));
        }
    });
    ws.on('close', function () {
        console.log('WebSocket connection closed');
        if (playerId) {
            cleanupPlayer(playerId);
        }
    });
    ws.on('error', function (error) {
        console.error('WebSocket error:', error);
        if (playerId) {
            cleanupPlayer(playerId);
        }
    });
});
console.log("WebSocket server running on 0.0.0.0:".concat(port));
