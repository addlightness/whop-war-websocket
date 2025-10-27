import { WebSocketServer, WebSocket } from 'ws';

// Card interface (copied from gameContext to avoid JSX issues)
interface Card {
  suit: "hearts" | "diamonds" | "clubs" | "spades";
  rank: number; // 2-14 (Ace = 14)
  name: string; // e.g., "ace_of_hearts"
}

// Types
interface Player {
  id: string;
  name: string;
  ws: WebSocket;
  gameId?: string;
}

interface GameState {
  id: string;
  player1: Player;
  player2: Player;
  player1Deck: Card[];
  player2Deck: Card[];
  player1Card: Card | null;
  player2Card: Card | null;
  player1WarCards: Card[];
  player2WarCards: Card[];
  gameStatus: 'waiting' | 'playing' | 'war' | 'finished';
  currentPlayer: 'player1' | 'player2';
  winner: 'player1' | 'player2' | null;
  message: string;
  joinCode?: string;
}

interface WSMessage {
  type: 'join_queue' | 'create_game' | 'join_game' | 'game_action' | 'ping' | 'pong';
  data?: any;
}

// In-memory storage
const games = new Map<string, GameState>();
const queue = new Set<string>();
const playerConnections = new Map<string, WebSocket>();
const joinCodes = new Map<string, string>(); // code -> gameId

// Card utilities (copied from gameContext)
function createCard(name: string): Card {
  const parts = name.replace('.png', '').split('_');
  const rankStr = parts[0];
  const suit = parts[2] as Card['suit'];

  let rank: number;
  if (rankStr === 'ace') rank = 14;
  else if (rankStr === 'king') rank = 13;
  else if (rankStr === 'queen') rank = 12;
  else if (rankStr === 'jack') rank = 11;
  else rank = parseInt(rankStr);

  return { suit, rank, name };
}

function shuffleDeck(deck: Card[]): Card[] {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function createDeck(): Card[] {
  const suits: Card['suit'][] = ['hearts', 'diamonds', 'clubs', 'spades'];
  const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'jack', 'queen', 'king', 'ace'];

  const deck: Card[] = [];
  suits.forEach(suit => {
    ranks.forEach(rank => {
      deck.push(createCard(`${rank}_of_${suit}`));
    });
  });

  return shuffleDeck(deck);
}

function generateJoinCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function formatCardName(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

function formatCardRank(name: string): string {
  const parts = name.replace('.png', '').split('_');
  const rankStr = parts[0];

  if (rankStr === 'ace') return 'Aces';
  else if (rankStr === 'king') return 'Kings';
  else if (rankStr === 'queen') return 'Queens';
  else if (rankStr === 'jack') return 'Jacks';
  else return `${rankStr}s`;
}

// Game logic
function startGame(player1: Player, player2: Player, joinCode?: string): GameState {
  const deck = createDeck();
  const shuffledDeck = shuffleDeck(deck);

  const game: GameState = {
    id: `game_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    player1,
    player2,
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
    joinCode
  };

  games.set(game.id, game);
  player1.gameId = game.id;
  player2.gameId = game.id;

  if (joinCode) {
    joinCodes.set(joinCode, game.id);
  }

  return game;
}

function processGameAction(game: GameState, action: string, playerId: string): GameState {
  if (game.gameStatus === 'finished') return game;

  // Check if it's the player's turn
  const isPlayer1 = playerId === game.player1.id;
  const isPlayer2 = playerId === game.player2.id;
  
  if (action === 'draw_card') {
    if (game.gameStatus === 'playing') {
      if ((isPlayer1 && game.currentPlayer === 'player1') || (isPlayer2 && game.currentPlayer === 'player2')) {
        return handleDrawCards(game, isPlayer1);
      }
    } else if (game.gameStatus === 'war') {
      if ((isPlayer1 && game.currentPlayer === 'player1') || (isPlayer2 && game.currentPlayer === 'player2')) {
        return handleResolveWar(game, isPlayer1);
      }
    }
  }

  return game;
}

function handleDrawCards(game: GameState, isPlayer1: boolean): GameState {
  const playerDeck = isPlayer1 ? game.player1Deck : game.player2Deck;
  const opponentDeck = isPlayer1 ? game.player2Deck : game.player1Deck;

  if (playerDeck.length === 0 || opponentDeck.length === 0) {
    const winner = playerDeck.length > 0 ? (isPlayer1 ? 'player1' : 'player2') : (isPlayer1 ? 'player2' : 'player1');
    return {
      ...game,
      gameStatus: 'finished',
      winner,
      message: `${isPlayer1 ? game.player1.name : game.player2.name} wins!`
    };
  }

  const playerCard = playerDeck[0];
  const opponentCard = opponentDeck[0];

  const newPlayerDeck = playerDeck.slice(1);
  const newOpponentDeck = opponentDeck.slice(1);

  if (playerCard.rank > opponentCard.rank) {
    // Player wins
    const updatedGame = {
      ...game,
      player1Deck: isPlayer1 ? [...newPlayerDeck, playerCard, opponentCard] : newPlayerDeck,
      player2Deck: isPlayer1 ? newOpponentDeck : [...newOpponentDeck, playerCard, opponentCard],
      player1Card: isPlayer1 ? playerCard : opponentCard,
      player2Card: isPlayer1 ? opponentCard : playerCard,
      message: `${isPlayer1 ? game.player1.name : game.player2.name} wins! ${formatCardName(playerCard.name)} beats ${formatCardName(opponentCard.name)}`,
      currentPlayer: (isPlayer1 ? 'player1' : 'player2') as 'player1' | 'player2'
    };
    return updatedGame;
  } else if (opponentCard.rank > playerCard.rank) {
    // Opponent wins
    const updatedGame = {
      ...game,
      player1Deck: isPlayer1 ? newPlayerDeck : [...newPlayerDeck, playerCard, opponentCard],
      player2Deck: isPlayer1 ? [...newOpponentDeck, playerCard, opponentCard] : newOpponentDeck,
      player1Card: isPlayer1 ? playerCard : opponentCard,
      player2Card: isPlayer1 ? opponentCard : playerCard,
      message: `${isPlayer1 ? game.player2.name : game.player1.name} wins! ${formatCardName(opponentCard.name)} beats ${formatCardName(playerCard.name)}`,
      currentPlayer: (isPlayer1 ? 'player2' : 'player1') as 'player1' | 'player2'
    };
    return updatedGame;
  } else {
    // War!
    const playerWarCards = newPlayerDeck.slice(0, 3);
    const opponentWarCards = newOpponentDeck.slice(0, 3);

    return {
      ...game,
      player1Deck: isPlayer1 ? newPlayerDeck.slice(3) : newPlayerDeck,
      player2Deck: isPlayer1 ? newOpponentDeck : newOpponentDeck.slice(3),
      player1Card: isPlayer1 ? playerCard : opponentCard,
      player2Card: isPlayer1 ? opponentCard : playerCard,
      player1WarCards: isPlayer1 ? playerWarCards : opponentWarCards,
      player2WarCards: isPlayer1 ? opponentWarCards : playerWarCards,
      gameStatus: 'war',
      message: `WAR! Both cards are ${formatCardRank(playerCard.name)}. Click to resolve the war!`,
      currentPlayer: (isPlayer1 ? 'player1' : 'player2') as 'player1' | 'player2'
    };
  }
}

function handleResolveWar(game: GameState, isPlayer1: boolean): GameState {
  const playerDeck = isPlayer1 ? game.player1Deck : game.player2Deck;
  const opponentDeck = isPlayer1 ? game.player2Deck : game.player1Deck;

  if (playerDeck.length < 1 || opponentDeck.length < 1) {
    const winner = playerDeck.length >= 1 ? (isPlayer1 ? 'player1' : 'player2') : (isPlayer1 ? 'player2' : 'player1');
    return {
      ...game,
      gameStatus: 'finished',
      winner,
      message: `${isPlayer1 ? game.player1.name : game.player2.name} wins! Opponent ran out of cards during war!`
    };
  }

  const playerWarCard = playerDeck[0];
  const opponentWarCard = opponentDeck[0];

  const allWarCards = [
    game.player1Card!,
    game.player2Card!,
    ...game.player1WarCards,
    ...game.player2WarCards,
    playerWarCard,
    opponentWarCard,
  ];

  const newPlayerDeck = playerDeck.slice(1);
  const newOpponentDeck = opponentDeck.slice(1);

  if (playerWarCard.rank > opponentWarCard.rank) {
    // Player wins war
    return {
      ...game,
      player1Deck: isPlayer1 ? [...newPlayerDeck, ...allWarCards] : newPlayerDeck,
      player2Deck: isPlayer1 ? newOpponentDeck : [...newOpponentDeck, ...allWarCards],
      player1Card: isPlayer1 ? playerWarCard : opponentWarCard,
      player2Card: isPlayer1 ? opponentWarCard : playerWarCard,
      player1WarCards: [],
      player2WarCards: [],
      gameStatus: 'playing',
      message: `${isPlayer1 ? game.player1.name : game.player2.name} wins the war! ${formatCardName(playerWarCard.name)} beats ${formatCardName(opponentWarCard.name)}`,
      currentPlayer: (isPlayer1 ? 'player1' : 'player2') as 'player1' | 'player2'
    };
  } else if (opponentWarCard.rank > playerWarCard.rank) {
    // Opponent wins war
    return {
      ...game,
      player1Deck: isPlayer1 ? newPlayerDeck : [...newPlayerDeck, ...allWarCards],
      player2Deck: isPlayer1 ? [...newOpponentDeck, ...allWarCards] : newOpponentDeck,
      player1Card: isPlayer1 ? playerWarCard : opponentWarCard,
      player2Card: isPlayer1 ? opponentWarCard : playerWarCard,
      player1WarCards: [],
      player2WarCards: [],
      gameStatus: 'playing',
      message: `${isPlayer1 ? game.player2.name : game.player1.name} wins the war! ${formatCardName(opponentWarCard.name)} beats ${formatCardName(playerWarCard.name)}`,
      currentPlayer: (isPlayer1 ? 'player2' : 'player1') as 'player1' | 'player2'
    };
  } else {
    // Another war!
    const newPlayerWarCards = newPlayerDeck.slice(0, 3);
    const newOpponentWarCards = newOpponentDeck.slice(0, 3);

    return {
      ...game,
      player1Deck: isPlayer1 ? newPlayerDeck.slice(3) : newPlayerDeck,
      player2Deck: isPlayer1 ? newOpponentDeck : newOpponentDeck.slice(3),
      player1Card: isPlayer1 ? playerWarCard : opponentWarCard,
      player2Card: isPlayer1 ? opponentWarCard : playerWarCard,
      player1WarCards: [
        game.player1Card!,
        ...game.player1WarCards,
        ...(isPlayer1 ? newPlayerWarCards : newOpponentWarCards),
      ],
      player2WarCards: [
        game.player2Card!,
        ...game.player2WarCards,
        ...(isPlayer1 ? newOpponentWarCards : newPlayerWarCards),
      ],
      message: `Another WAR! Both cards are ${formatCardRank(playerWarCard.name)}. Click to resolve the war.`,
      currentPlayer: (isPlayer1 ? 'player1' : 'player2') as 'player1' | 'player2'
    };
  }
}

function broadcastToGame(game: GameState, message: any) {
  const gameData = {
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

  if (game.player1.ws.readyState === WebSocket.OPEN) {
    game.player1.ws.send(JSON.stringify(gameData));
  }
  if (game.player2.ws.readyState === WebSocket.OPEN) {
    game.player2.ws.send(JSON.stringify(gameData));
  }
}

function cleanupPlayer(playerId: string) {
  const player = playerConnections.get(playerId);
  if (player) {
    playerConnections.delete(playerId);
    queue.delete(playerId);
    
    // Find and cleanup any games this player was in
    for (const [gameId, game] of games.entries()) {
      if (game.player1.id === playerId || game.player2.id === playerId) {
        // Notify opponent about disconnection
        const opponent = game.player1.id === playerId ? game.player2 : game.player1;
        if (opponent.ws.readyState === WebSocket.OPEN) {
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
const wss = new WebSocketServer({ port: 3001 });

wss.on('connection', (ws: WebSocket, req) => {
  console.log('New WebSocket connection');
  
  let playerId: string | null = null;

  ws.on('message', (data: Buffer) => {
    try {
      const message: WSMessage = JSON.parse(data.toString());
      
      switch (message.type) {
        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' }));
          break;
          
        case 'join_queue':
          if (message.data?.playerId && message.data?.name) {
            playerId = message.data.playerId;
            const player: Player = {
              id: message.data.playerId,
              name: message.data.name,
              ws
            };
            
            playerConnections.set(message.data.playerId, ws);
            
            // Check if there's someone in queue
            if (queue.size > 0) {
              const waitingPlayerId = queue.values().next().value;
              if (waitingPlayerId) {
                queue.delete(waitingPlayerId);
                
                const waitingPlayer = playerConnections.get(waitingPlayerId);
                if (waitingPlayer) {
                const waitingPlayerData: Player = {
                  id: waitingPlayerId,
                  name: message.data.waitingPlayerName || 'Player',
                  ws: waitingPlayer
                };
                
                const game = startGame(waitingPlayerData, player);
                broadcastToGame(game, null);
                }
              }
            } else {
              queue.add(message.data.playerId);
              ws.send(JSON.stringify({
                type: 'queue_joined',
                data: { message: 'Waiting for opponent...' }
              }));
            }
          }
          break;
          
        case 'create_game':
          if (message.data?.playerId && message.data?.name) {
            playerId = message.data.playerId;
            const player: Player = {
              id: message.data.playerId,
              name: message.data.name,
              ws
            };
            
            playerConnections.set(message.data.playerId, ws);
            
            const joinCode = generateJoinCode();
            const game = startGame(player, player, joinCode);
            game.gameStatus = 'waiting';
            game.message = `Game created! Share code: ${joinCode}`;
            
            ws.send(JSON.stringify({
              type: 'game_created',
              data: { joinCode, gameId: game.id }
            }));
          }
          break;
          
        case 'join_game':
          if (message.data?.playerId && message.data?.name && message.data?.joinCode) {
            playerId = message.data.playerId;
            const gameId = joinCodes.get(message.data.joinCode);
            
            if (gameId && games.has(gameId)) {
              const game = games.get(gameId)!;
              if (game.gameStatus === 'waiting') {
                const player: Player = {
                  id: message.data.playerId,
                  name: message.data.name,
                  ws
                };
                
                playerConnections.set(message.data.playerId, ws);
                game.player2 = player;
                game.gameStatus = 'playing';
                game.message = 'Game started! Player 1 goes first.';
                
                // Update the games Map with the modified game
                games.set(game.id, game);
                broadcastToGame(game, null);
              } else {
                ws.send(JSON.stringify({
                  type: 'error',
                  data: { message: 'Game is already full or in progress.' }
                }));
              }
            } else {
              ws.send(JSON.stringify({
                type: 'error',
                data: { message: 'Invalid join code.' }
              }));
            }
          }
          break;
          
        case 'game_action':
          if (playerId && message.data?.action) {
            const game = Array.from(games.values()).find(g => 
              g.player1.id === playerId || g.player2.id === playerId
            );
            
            if (game) {
              const updatedGame = processGameAction(game, message.data.action, playerId);
              games.set(updatedGame.id, updatedGame);
              broadcastToGame(updatedGame, null);
            }
          }
          break;
      }
    } catch (error) {
      console.error('Error processing message:', error);
      ws.send(JSON.stringify({
        type: 'error',
        data: { message: 'Invalid message format.' }
      }));
    }
  });

  ws.on('close', () => {
    console.log('WebSocket connection closed');
    if (playerId) {
      cleanupPlayer(playerId);
    }
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    if (playerId) {
      cleanupPlayer(playerId);
    }
  });
});

console.log('WebSocket server running on port 3001');
