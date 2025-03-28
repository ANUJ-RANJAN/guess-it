# GuessIT

**GuessIT** is a fun and interactive multiplayer guessing game built using **Reddit’s Devvit Developer Platform**. It offers two engaging gameplay modes, designed to stimulate creativity, encourage active participation, and generate conversations among Redditors.

---

## 🎮 Game Modes Overview

### 🗂️ Category Game

- **Objective:** Guess the correct answer based on clues provided.
- **Gameplay:**
  - Each puzzle provides multiple descriptive clues (including emojis and short text).
  - Clues are revealed one-by-one upon request.
  - Players have **4 lives** per puzzle.
  - Lives are shown visually as hearts (`❤️` for remaining lives, `♡` for lost lives) at the top right of the screen.
  - Correct guesses award points immediately and transition automatically to a new puzzle.
  - After **4 incorrect guesses**, the player is eliminated, and the correct answer is revealed. The game session ends, and the score is saved as **"Last Score"** displayed on the home screen.

### 🔤 WordIT Mode

- **Objective:** Guess the word based on given definitions and revealed letters.
- **Gameplay:**
  - Each word has two descriptive clues (definitions).
  - Players have **3 attempts** per word.
  - With each incorrect guess, a letter in the word is revealed to aid guessing.
  - A correct guess immediately awards points and loads a new puzzle.
  - After **3 failed attempts**, the correct word is shown, the game ends, and the score is saved as the **"Last Score"** displayed on the home screen.

---

## ❤️ Life Component (Detailed)

- Lives are visually represented using heart icons:
  - **Category Game:** 4 lives per puzzle (`❤️❤️❤️❤️` initially).
  - **WordIT Mode:** 3 attempts per puzzle (`❤️❤️❤️` initially).
- Incorrect guesses cause hearts to empty one by one (`♡`).
- Upon losing all hearts:
  - The correct answer is displayed clearly.
  - The player's session ends immediately, returning to the home screen.

---

## 🥇 Leaderboard & Scoring

- The game features a **real-time leaderboard** using Redis:
  - Scores are updated instantly after each puzzle or game session.
  - Leaderboard showcases the top 5 scores prominently.
- **Last Score Feature**:
  - After each game ends, the player's final score is prominently displayed on the home screen as "Last Score".

---

## 🎲 How to Play

### 🚀 Starting the Game:

- Enter your username or play as a guest.
- From the Home screen, select:
  - **Start Game** to play the Category Game.
  - **Play WordIT** for Word guessing mode.
  - **View Leaderboard** to see top scores.

### 🔍 Gameplay Steps:

**Category Game:**

1. Read the revealed clue(s).
2. Enter your guess using the provided input form.
3. If correct, earn points based on the clues revealed and automatically proceed to the next puzzle.
4. If incorrect, lose one life. Lose all lives, and the session ends.

**WordIT Mode:**

1. Two definitions (clues) are given.
2. Enter your guess. If incorrect, letters of the word will be revealed progressively.
3. Guess correctly to score points and continue to the next puzzle immediately.
4. If all attempts are used, the game session ends.

---

## ⚙️ Technical Stack & Details

- **Platform:** [Reddit Devvit Platform](https://developers.reddit.com/)
- **Frontend/UI:** React-like components provided by Devvit (Blocks UI), styled for Reddit feeds.
- **Real-time Interactions:** Utilizes Devvit’s realtime channels for immediate leaderboard updates.
- **Data Storage:** Redis for real-time score and leaderboard management.
- **Performance:** Optimized following Devvit best practices to ensure a smooth and responsive experience within Reddit feeds.

---

## 🎖️ Submission Information

- **App Listing URL:** *(Include your URL here: developers.reddit.com/apps/{your-app-name})*
- **Demo Post:** *(Include the link to your subreddit post demonstrating the game.)*
- **Repository:** *(Optional: Include your public repo URL here.)*
- **Video Walkthrough:** *(Optional: Include your demo video link here.)*

---

## 🌟 Final Thoughts

GuessIT is crafted to seamlessly integrate into Reddit’s feed environment, promoting friendly competition, encouraging conversation, and offering users a fun, engaging experience. The life mechanics ensure the game remains challenging and exciting, while the real-time leaderboard and scoring system foster a strong sense of community.

Enjoy guessing! 🚀🎮

