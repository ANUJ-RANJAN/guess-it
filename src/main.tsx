import { Devvit, useState, useForm, useChannel } from '@devvit/public-api';
import categoriesData from './categories.json' with { type: 'json' };
import wordsData from './words.json' with { type: 'json' };

Devvit.configure({
  redis: true,
  redditAPI: true,
  realtime: true,
});

// Category data
type Categories = Record<string, Record<string, string[]>>;
const categories: Categories = categoriesData;

// WordIT data
type WordItem = {
  word: string;
  definitions: string[]; // exactly two definitions
};
const words: WordItem[] = wordsData;

// Always use a black background
const getBackgroundColor = () => 'black';

Devvit.addCustomPostType({
  name: 'GuessIT',
  description: 'A fun guessing game with different categories, plus WordIT mode',
  render: (context) => {
    // ============================
    // GLOBAL STATES
    // ============================
    const [category, setCategory] = useState('cricket');
    const [currentItem, setCurrentItem] = useState('');
    const [clueIndex, setClueIndex] = useState(0);
    const [userGuess, setUserGuess] = useState('');
    const [message, setMessage] = useState('');
    const [score, setScore] = useState(0);
    const [showLeaderboard, setShowLeaderboard] = useState(false);
    const [leaderboard, setLeaderboard] = useState<Array<{ member: string; score: number }>>([]);
    const [username, setUsername] = useState('');
    const [showHome, setShowHome] = useState(true);
    const [showWordIt, setShowWordIt] = useState(false);
    const [showLeaderboardView, setShowLeaderboardView] = useState(false);
    // 4-lives for the main game
    const [wrongCount, setWrongCount] = useState(0);
    // WordIT states
    const [currentWord, setCurrentWord] = useState<WordItem | null>(null);
    const [wordAttempt, setWordAttempt] = useState(1);
    const [revealedLetters, setRevealedLetters] = useState<string[]>([]);

    // ============================
    // On load: fetch current user
    // ============================
    useState(() => {
      const fetchUser = async () => {
        try {
          const currentUser = await context.reddit.getCurrentUser();
          if (currentUser) setUsername(currentUser.username);
        } catch (error) {
          console.error('Error getting current user:', error);
        }
      };
      fetchUser();
      return null;
    });

    // ============================
    // Leaderboard logic
    // ============================
    const getLeaderboard = async () => {
      return await context.redis.zRange('leaderboard', 0, 4, {
        reverse: true,
        by: 'score',
      });
    };
    useState(() => {
      const fetchLeaderboard = async () => {
        try {
          const initialLB = await getLeaderboard();
          setLeaderboard(
            initialLB.filter(
              (entry): entry is { member: string; score: number } =>
                typeof entry === 'object' && entry !== null && 'member' in entry && 'score' in entry
            )
          );
        } catch (error) {
          console.error('Error fetching leaderboard:', error);
        }
      };
      fetchLeaderboard();
      return null;
    });
    const channel = useChannel({
      name: 'leaderboard_updates',
      onMessage: (newEntry) => {
        const newLB = [...leaderboard, newEntry]
          .sort((a, b) => {
            const scoreA = typeof a === 'object' && a !== null && 'score' in a ? Number(a.score) : 0;
            const scoreB = typeof b === 'object' && b !== null && 'score' in b ? Number(b.score) : 0;
            return scoreB - scoreA;
          })
          .slice(0, 5);
        setLeaderboard(
          newLB.filter(
            (entry): entry is { member: string; score: number } =>
              typeof entry === 'object' && entry !== null && 'member' in entry && 'score' in entry
          )
        );
      },
    });
    const saveScore = async (playerUsername: string, gameScore: number) => {
      try {
        await context.redis.zAdd('leaderboard', { member: playerUsername, score: gameScore });
        context.realtime.send('leaderboard_updates', { member: playerUsername, score: gameScore });
        const updatedLB = await getLeaderboard();
        setLeaderboard(
          updatedLB.filter(
            (entry): entry is { member: string; score: number } =>
              typeof entry === 'object' && entry !== null && 'member' in entry && 'score' in entry
          )
        );
      } catch (error) {
        console.error('Error saving score:', error);
      }
    };

    // ============================
    // Forms
    // ============================
    const nameForm = useForm(
      {
        title: 'Enter your name',
        fields: [{ name: 'username', label: 'Your Name', type: 'string' }],
        acceptLabel: 'Save',
      },
      (values) => {
        setUsername(values.username || `Guest-${Math.floor(Math.random() * 10000)}`);
        context.ui.showToast(`Welcome, ${values.username || 'Guest'}!`);
      }
    );
    const guessForm = useForm(
      {
        title: 'Enter your guess',
        fields: [{ name: 'guess', label: 'Your guess', type: 'string' }],
      },
      (values) => {
        setUserGuess(values.guess || '');
        setTimeout(() => checkGuess(), 100);
      }
    );
    const wordITGuessForm = useForm(
      {
        title: 'Enter your guess',
        fields: [{ name: 'guess', label: 'Your guess', type: 'string' }],
      },
      (values) => {
        setUserGuess(values.guess || '');
        setTimeout(() => checkWordITGuess(), 100);
      }
    );

    // ============================
    // Category Game (4 Lives)
    // ============================
    const startNewRound = () => {
      setWrongCount(0);
      setUserGuess('');
      setMessage('');
      setClueIndex(0);
      const items = Object.keys(categories[category]);
      if (items.length === 0) return;
      const newIndex = Math.floor(Math.random() * items.length);
      setCurrentItem(items[newIndex]);
    };

    const checkGuess = async () => {
      if (!currentItem) return;
      if (userGuess.trim().toLowerCase() === currentItem.toLowerCase()) {
        const pointsEarned = Math.max(1, 5 - clueIndex);
        setMessage(`Correct! You earned ${pointsEarned} point${pointsEarned > 1 ? 's' : ''}!`);
        const newScore = score + pointsEarned;
        setScore(newScore);
        if (username) await saveScore(username, newScore);
        startNewRound(); // Immediately advance to next puzzle
      } else {
        const newWrong = wrongCount + 1;
        setWrongCount(newWrong);
        if (newWrong >= 4) {
          setMessage(`You have been eliminated! The correct answer was: ${currentItem}`);
          if (username) await saveScore(username, score);
          // End the game and return to Home immediately
          setShowHome(true);
        } else {
          setMessage("Sorry, that's not correct. Try again!");
        }
      }
      setUserGuess('');
    };

    const changeCategory = (newCategory: string) => {
      setCategory(newCategory);
      setWrongCount(0);
      setUserGuess('');
      setMessage('');
      setClueIndex(0);
      const items = Object.keys(categories[newCategory]);
      if (items.length === 0) return;
      const newIndex = Math.floor(Math.random() * items.length);
      setCurrentItem(items[newIndex]);
    };

    const isMainGameDisabled = wrongCount >= 4;

    // ============================
    // WordIT Mode
    // ============================
    const startWordITRound = () => {
      setWordAttempt(1);
      setUserGuess('');
      setMessage('');
      if (words.length === 0) return;
      const newIndex = Math.floor(Math.random() * words.length);
      setCurrentWord(words[newIndex]);
      const underscores = words[newIndex].word.split('').map(() => '_');
      setRevealedLetters(underscores);
    };

    const revealRandomLetter = () => {
      if (!currentWord) return;
      const wordArray = currentWord.word.toUpperCase().split('');
      const newRevealed = [...revealedLetters];
      const hiddenIndices = newRevealed
        .map((char, i) => (char === '_' ? i : -1))
        .filter((x) => x !== -1);
      if (hiddenIndices.length > 0) {
        const randIdx = Math.floor(Math.random() * hiddenIndices.length);
        newRevealed[hiddenIndices[randIdx]] = wordArray[hiddenIndices[randIdx]];
        setRevealedLetters(newRevealed);
      }
    };

    const checkWordITGuess = async () => {
      if (!currentWord) return;
      if (userGuess.trim().toLowerCase() === currentWord.word.toLowerCase()) {
        const pointsEarned = Math.max(1, 4 - wordAttempt);
        setMessage(`Correct! You earned ${pointsEarned} point${pointsEarned > 1 ? 's' : ''}!`);
        const newScore = score + pointsEarned;
        setScore(newScore);
        if (username) await saveScore(username, newScore);
        startWordITRound(); // Immediately pick a new word on correct guess
      } else {
        const nextAttempt = wordAttempt + 1;
        setWordAttempt(nextAttempt);
        if (nextAttempt > 3) {
          setMessage(`No more attempts! The correct word was: ${currentWord.word}.`);
          if (username) await saveScore(username, score);
          // Instead of starting a new word, return to Home when out of attempts
          setShowWordIt(false);
          setShowHome(true);
        } else {
          setMessage('Sorry, try again!');
          revealRandomLetter();
        }
      }
      setUserGuess('');
    };

    const isWordITDisabled = wordAttempt > 3;

    // If no puzzle has been picked in the category game, pick one now
    if (!currentItem && !showHome && !showWordIt && !showLeaderboardView) {
      startNewRound();
    }

    // ============================
    // Rendering Views
    // ============================
    let content;
    if (showHome) {
      // HOME PAGE
      content = (
        <vstack padding="medium" gap="large" alignment="center" backgroundColor={getBackgroundColor()}>
          <text style="heading" size="xxlarge">GuessIT</text>
          <image
            url="logo.png"
            imageWidth={150}
            imageHeight={150}
            description="GuessIT game logo"
          />
          <vstack gap="medium" width="80%">
            <button
              appearance="primary"
              onPress={() => {
                context.ui.showForm(nameForm);
              }}
            >
              Enter Your Name
            </button>
            <text>{username ? `Playing as: ${username}` : 'No name entered yet'}</text>
            <button
              appearance="primary"
              onPress={() => {
                if (!username) {
                  setUsername(`Guest-${Math.floor(Math.random() * 10000)}`);
                }
                setShowHome(false);
                setShowWordIt(false);
                setShowLeaderboardView(false);
                startNewRound();
              }}
              size="large"
            >
              Start Game
            </button>
            <button
              appearance="primary"
              onPress={() => {
                if (!username) {
                  setUsername(`Guest-${Math.floor(Math.random() * 10000)}`);
                }
                setShowHome(false);
                setShowWordIt(true);
                setShowLeaderboardView(false);
                startWordITRound();
              }}
              size="large"
            >
              Play WordIT
            </button>
            <button
              appearance="secondary"
              onPress={() => {
                setShowHome(false);
                setShowWordIt(false);
                setShowLeaderboardView(true);
              }}
              size="large"
            >
              View Leaderboard
            </button>
          </vstack>
          <text size="small">A fun emoji guessing game!</text>
        </vstack>
      );
    } else if (showWordIt) {
      // WORDIT MODE
      const attemptUsed = wordAttempt - 1;
      const attemptHearts = '❤️'.repeat(Math.max(0, 3 - attemptUsed)) + '♡'.repeat(attemptUsed);

      content = (
        <vstack padding="medium" gap="medium" alignment="center" backgroundColor={getBackgroundColor()}>
          <hstack width="100%" alignment="start top" gap="medium">
            <button
              appearance="secondary"
              size="small"
              icon="back"
              onPress={() => {
                setShowWordIt(false);
                setShowHome(true);
              }}
            >
              Back
            </button>
            <text style="heading" size="small">Score: {score}</text>
            <spacer />
            <text>{attemptHearts}</text>
          </hstack>
          <text style="heading" size="xlarge">WordIT Mode</text>
          {currentWord ? (
            <>
              {(() => {
                const [def1, def2] = currentWord.definitions;
                if (wordAttempt === 1) {
                  return <text>Clue 1: {def1}</text>;
                } else {
                  return (
                    <>
                      <text>Clue 1: {def1}</text>
                      <text>Clue 2: {def2}</text>
                    </>
                  );
                }
              })()}
              <text size="large">{revealedLetters.join(' ')}</text>
              <text>(Guess the word!)</text>
              <button onPress={() => context.ui.showForm(wordITGuessForm)} disabled={isWordITDisabled}>
                Enter Guess
              </button>
              {userGuess && <text>Current guess: {userGuess}</text>}
              <button onPress={checkWordITGuess} appearance="primary" disabled={isWordITDisabled}>
                Submit Guess
              </button>
              {message && <text color={message.includes('Correct') ? 'green' : 'red'}>{message}</text>}
              <text style="heading">Score: {score}</text>
            </>
          ) : (
            <text>Loading word...</text>
          )}
          <button
            onPress={() => {
              setShowWordIt(false);
              setShowHome(true);
            }}
          >
            Back to Home
          </button>
        </vstack>
      );
    } else if (showLeaderboardView) {
      // LEADERBOARD PAGE
      content = (
        <vstack padding="medium" gap="medium" alignment="center" backgroundColor={getBackgroundColor()}>
          <hstack width="100%" alignment="start top" gap="medium">
            <button
              appearance="secondary"
              size="small"
              icon="back"
              onPress={() => {
                setShowLeaderboardView(false);
                setShowHome(true);
              }}
            >
              Back
            </button>
            <text style="heading" size="xlarge">Leaderboard</text>
          </hstack>
          {leaderboard.length > 0 ? (
            leaderboard.map((entry, index) => (
              <hstack key={index.toString()} gap="medium" alignment="center">
                <text style="heading" size="small">{index + 1}.</text>
                <text size="small">{entry.member}</text>
                <spacer />
                <text style="heading" size="small">{entry.score}</text>
              </hstack>
            ))
          ) : (
            <text size="small">No scores yet. Be the first!</text>
          )}
          <button
            onPress={() => {
              setShowLeaderboardView(false);
              setShowHome(true);
            }}
            appearance="primary"
          >
            Back to Home
          </button>
        </vstack>
      );
    } else {
      // CATEGORY GAME UI
      const usedLives = wrongCount;
      const maxLives = 4;
      const heartsDisplay = '❤️'.repeat(Math.max(0, maxLives - usedLives)) + '♡'.repeat(usedLives);

      content = (
        <vstack padding="medium" gap="medium" alignment="center" backgroundColor={getBackgroundColor()}>
          <hstack width="100%" alignment="start top" gap="medium">
            <button
              appearance="secondary"
              size="small"
              icon="back"
              onPress={() => setShowHome(true)}
            >
              Back
            </button>
            <text style="heading" size="small">Score: {score}</text>
            <spacer />
            <text>{heartsDisplay}</text>
          </hstack>
          <text style="heading" size="xlarge">Guess The Clue!</text>
          <text>Current Category: {category}</text>
          <hstack gap="medium">
            {Object.keys(categories).map((cat) => (
              <button
                key={cat}
                onPress={() => changeCategory(cat)}
                appearance={category === cat ? 'primary' : 'secondary'}
              >
                {cat.charAt(0).toUpperCase() + cat.slice(1)}
              </button>
            ))}
          </hstack>
          <vstack padding="medium" gap="medium" border="thin" borderColor="neutral" cornerRadius="medium">
            <text style="heading" size="large">Clue</text>
            <vstack gap="small">
  {currentItem &&
    categories[category][currentItem].slice(0, clueIndex + 1).map((clue, index) => (
      <text key={index.toString()} size="small">{clue}</text>
    ))}
</vstack>

            <text>(Guess based on the clues above)</text>
            {clueIndex < categories[category][currentItem]?.length - 1 && (
              <button onPress={() => setClueIndex(clueIndex + 1)}>Show Next Clue</button>
            )}
          </vstack>
          <vstack gap="small" width="100%">
            <button onPress={() => context.ui.showForm(guessForm)} disabled={isMainGameDisabled}>
              Enter guess
            </button>
            {userGuess && <text>Current guess: {userGuess}</text>}
            <button onPress={checkGuess} appearance="primary" disabled={isMainGameDisabled}>
              Submit Guess
            </button>
          </vstack>
          {message && <text color={message.includes('Correct') ? 'green' : 'red'}>{message}</text>}
          <text style="heading">Score: {score}</text>
          <button onPress={startNewRound} disabled={isMainGameDisabled}>
            New Clue
          </button>
        </vstack>
      );
    }

    return <blocks height="tall">{content}</blocks>;
  },
});

Devvit.addMenuItem({
  location: 'subreddit',
  label: 'Create Guessing Game',
  onPress: async (_, context) => {
    const currentSubreddit = await context.reddit.getCurrentSubreddit();
    await context.reddit.submitPost({
      title: 'GuessIT',
      subredditName: currentSubreddit.name,
      preview: (
        <vstack>
          <text>Loading Guessing Game...</text>
        </vstack>
      ),
    });
    context.ui.showToast(`Created Guessing Game in r/${currentSubreddit.name}`);
  },
});

export default Devvit;
