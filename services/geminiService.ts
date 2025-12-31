
import { GoogleGenAI } from "@google/genai";
import { GameState } from "../types";

export const getTacticalAdvice = async (gameState: GameState): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  const playerUnits = gameState.units.filter(u => u.team === 'player');
  const visibleEnemies = gameState.units.filter(u => u.team === 'enemy' && !gameState.fogOfWar[u.y][u.x]);

  const prompt = `
    Act as a tactical AI advisor for a turn-based grid game (15x20).
    Current Turn: ${gameState.turn}
    Player Units: ${playerUnits.map(u => `[ID:${u.id}, POS:(${u.x},${u.y}), HP:${u.hp}/${u.maxHp}, AP:${u.ap}]`).join(', ')}
    Visible Enemies: ${visibleEnemies.map(u => `[POS:(${u.x},${u.y}), HP:${u.hp}]`).join(', ')}
    Obstacles are scattered across the map.
    The goal is to eliminate all enemies.
    
    Give a one-sentence, sharp tactical suggestion for the current turn.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
    });
    return response.text || "Eyes on the target. Stay sharp.";
  } catch (error) {
    console.error("Gemini Advice Error:", error);
    return "Tactical link unstable. Maintain formation and engage hostiles.";
  }
};
