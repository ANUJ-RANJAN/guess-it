import { Devvit, useState, useForm, useChannel } from '@devvit/public-api';
// Existing categories
import categoriesData from './categories.json' with { type: 'json' };
// Words JSON for WordIT
import wordsData from './words.json' with { type: 'json' };

Devvit.configure({
  redis: true,
  redditAPI: true,
  realtime: true,
});

// Types
type Categories = Record<string, Record<string, string[]>>;
const categories: Categories = categoriesData;

type WordItem = {
  word: string;
  definitions: string[]; // Exactly two definitions
};

const words: WordItem[] = wordsData;

// A constant black background
const backgroundColor = '#000';

Devvit.addCustomPostType({
  name: 'GuessIT',
  description: 'A fun guessing game with different categories, plus WordIT mode',
  render: (context) => {
    // Main game states
    const [category, setCategory] = useState('cricket');
    const [currentItem, setCurrentItem] = useState('');
    const [clueIndex, setClueIndex] = useState(0);
    const [userGuess, setUserGuess] = useState('');
    const [message, setMessage] = useState('');
    const [score, setScore] = useState(0);
    const [leaderboard, setLeaderboard] = useState<Array<{ member: string; score: number }>>([]);
    const [username, setUsername] = useState('');
    const [currentView, setCurrentView] = useState<
      'home' | 'game' | 'leaderboard' | 'wordit'
    >('home');
    const [wrongCount, setWrongCount] = useState(0);
    const [eliminated, setEliminated] = useState(false);

    // WordIT states
    const [currentWord, setCurrentWord] = useState<WordItem | null>(null);
    // 3 attempts total. Attempt #1 => 3 points, #2 => 2 points, #3 => 1 point
    const [wordAttempt, setWordAttempt] = useState(1);
    const [revealedLetters, setRevealedLetters] = useState<string[]>([]);

    // On load, get current user
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

    // Leaderboard logic
    const getLeaderboard = async () => {
      return await context.redis.zRange('leaderboard', 0, 4, {
        reverse: true,
        by: 'score',
      });
    };

    useState(() => {
      const fetchLeaderboard = async () => {
        try {
          const initialLeaderboard = await getLeaderboard();
          setLeaderboard(
            initialLeaderboard.filter(
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

    // Realtime channel for leaderboard
    const channel = useChannel({
      name: 'leaderboard_updates',
      onMessage: (newLeaderboardEntry) => {
        const newLeaderboard = [...leaderboard, newLeaderboardEntry]
          .sort((a, b) => {
            const scoreA = typeof a === 'object' && a !== null && 'score' in a ? Number(a.score) : 0;
            const scoreB = typeof b === 'object' && b !== null && 'score' in b ? Number(b.score) : 0;
            return scoreB - scoreA;
          })
          .slice(0, 5);

        setLeaderboard(
          newLeaderboard.filter(
            (entry): entry is { member: string; score: number } =>
              typeof entry === 'object' && entry !== null && 'member' in entry && 'score' in entry
          )
        );
      },
    });

    // Save score
    const saveScore = async (playerUsername: string, gameScore: number) => {
      try {
        await context.redis.zAdd('leaderboard', { member: playerUsername, score: gameScore });
        context.realtime.send('leaderboard_updates', { member: playerUsername, score: gameScore });
      } catch (error) {
        console.error('Error saving score:', error);
      }
    };

    // Form for the name
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

    // Guess form for main game
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

    // Guess form for WordIT
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

    // ---------------------------
    // 1) Main Category Game Logic
    // ---------------------------
    const startNewRound = () => {
      if (wrongCount >= 5) return;
      const items = Object.keys(categories[category]);
      const randomItem = items[Math.floor(Math.random() * items.length)];
      setCurrentItem(randomItem);
      setClueIndex(0);
      setMessage('');
    };

    const checkGuess = async () => {
      if (wrongCount >= 5) return;
      if (userGuess.toLowerCase() === currentItem.toLowerCase()) {
        const pointsEarned = Math.max(1, 5 - clueIndex);
        setMessage(`Correct! You earned ${pointsEarned} point${pointsEarned > 1 ? 's' : ''}!`);
        const newScore = score + pointsEarned;
        setScore(newScore);
        if (username) await saveScore(username, newScore);
      } else {
        const newWrongCount = wrongCount + 1;
        setWrongCount(newWrongCount);
        if (newWrongCount >= 5) {
          setMessage('You have been eliminated!');
          if (username) await saveScore(username, score);
          // Refresh leaderboard
          const updatedLeaderboard = await getLeaderboard();
          setLeaderboard(
            updatedLeaderboard.filter(
              (entry): entry is { member: string; score: number } =>
                typeof entry === 'object' && entry !== null && 'member' in entry && 'score' in entry
            )
          );
          setTimeout(() => {
            setEliminated(true);
            setCurrentView('home');
          }, 1500);
        } else {
          setMessage("Sorry, that's not correct. Try again!");
        }
      }
      setUserGuess('');
    };

    const changeCategory = (newCategory: string) => {
      setCategory(newCategory);
      const items = Object.keys(categories[newCategory]);
      const randomItem = items[Math.floor(Math.random() * items.length)];
      setCurrentItem(randomItem);
      setClueIndex(0);
      setMessage('');
    };

    const totalLives = 5;
    const livesRemaining = Math.max(0, totalLives - wrongCount);
    const heartsDisplay = '❤️'.repeat(livesRemaining) + '♡'.repeat(totalLives - livesRemaining);

    // ---------------------
    // 2) WordIT Game Logic
    //    3 attempts total
    // ---------------------
    const startWordITRound = () => {
      setWordAttempt(1);
      setUserGuess('');
      setMessage('');
      const randomIndex = Math.floor(Math.random() * words.length);
      const chosen = words[randomIndex];
      setCurrentWord(chosen);
      // Prepare underscores for each letter
      const underscores = chosen.word.split('').map(() => '_');
      setRevealedLetters(underscores);
    };

    // 3 total attempts => hearts
    const getWordITHearts = () => {
      const used = wordAttempt - 1;
      const remaining = 3 - used;
      return '❤️'.repeat(remaining) + '♡'.repeat(used);
    };

    const revealRandomLetter = () => {
      if (!currentWord) return;
      const wordArray = currentWord.word.toUpperCase().split('');
      const newRevealed = [...revealedLetters];
      // Find all indices still hidden
      const hiddenIndices = newRevealed
        .map((char, i) => (char === '_' ? i : -1))
        .filter((x) => x !== -1);
      if (hiddenIndices.length > 0) {
        const randIdx = Math.floor(Math.random() * hiddenIndices.length);
        const realIndex = hiddenIndices[randIdx];
        newRevealed[realIndex] = wordArray[realIndex];
        setRevealedLetters(newRevealed);
      }
    };

    const checkWordITGuess = async () => {
      if (!currentWord) return;
      if (userGuess.trim().toLowerCase() === currentWord.word.toLowerCase()) {
        // Attempt #1 => 3 points, #2 => 2, #3 => 1
        const pointsEarned = 4 - wordAttempt; // 1->3, 2->2, 3->1
        setMessage(`Correct! You earned ${pointsEarned} point${pointsEarned > 1 ? 's' : ''}!`);
        const newScore = score + pointsEarned;
        setScore(newScore);
        if (username) await saveScore(username, newScore);

        // After success, load next word
        setTimeout(() => {
          startWordITRound();
        }, 1500);
      } else {
        // Wrong guess
        const newAttempt = wordAttempt + 1;
        setWordAttempt(newAttempt);
        if (newAttempt > 3) {
          setMessage('No more attempts. You got 0 points!');
          // 0 points => next word
          setTimeout(() => {
            startWordITRound();
          }, 1500);
        } else {
          setMessage('Sorry, try again!');
          // Reveal a random letter after each wrong guess
          revealRandomLetter();
        }
      }
      setUserGuess('');
    };

    // Show definitions
    const getWordITDefinitions = () => {
      if (!currentWord) return [];
      const [def1, def2] = currentWord.definitions;
      if (wordAttempt === 1) {
        return [def1];
      } else {
        return [def1, def2];
      }
    };

    // ---------------------
    // Render Content
    // ---------------------
    let content;
    if (currentView === 'home') {
      // HOME SCREEN
      if (eliminated) {
        // If user got eliminated in the main game
        content = (
          <vstack padding="small" gap="small" alignment="center" backgroundColor={backgroundColor}>
            <text style="heading" size="medium">
              Game Over
            </text>
            <text size="small">Your final score: {score}</text>
            <button
              appearance="primary"
              onPress={() => {
                setEliminated(false);
                setScore(0);
                setWrongCount(0);
                setCurrentView('game');
                startNewRound();
              }}
              size="small"
            >
              Play Again
            </button>
            <button
              appearance="secondary"
              onPress={() => setCurrentView('leaderboard')}
              size="small"
            >
              View Leaderboard
            </button>
            <button
              appearance="secondary"
              onPress={() => {
                setEliminated(false);
                setScore(0);
                setWrongCount(0);
                setCurrentView('home');
              }}
              size="small"
            >
              Home
            </button>
          </vstack>
        );
      } else {
        // Normal home screen
        content = (
          <vstack padding="small" gap="small" alignment="center" backgroundColor={backgroundColor}>
            <text style="heading" size="medium">
              GuessIT
            </text>
            <image
              url="logo.png"
              imageWidth={80}
              imageHeight={80}
              description="GuessIT game logo"
            />
            <vstack gap="small" width="80%">
              <button
                appearance="primary"
                onPress={() => context.ui.showForm(nameForm)}
                size="small"
              >
                Enter Your Name
              </button>
              <text size="small">
                {username ? `Playing as: ${username}` : 'No name entered yet'}
              </text>
              <button
                appearance="primary"
                onPress={() => {
                  if (!username) {
                    setUsername(`Guest-${Math.floor(Math.random() * 10000)}`);
                  }
                  setScore(0);
                  setWrongCount(0);
                  setEliminated(false);
                  setCurrentView('game');
                  startNewRound();
                }}
                size="small"
              >
                Start Game
              </button>
              <button
                appearance="primary"
                onPress={() => {
                  if (!username) {
                    setUsername(`Guest-${Math.floor(Math.random() * 10000)}`);
                  }
                  setEliminated(false);
                  setCurrentView('wordit');
                  startWordITRound();
                }}
                size="small"
              >
                Play WordIT
              </button>
              <button
                appearance="secondary"
                onPress={() => setCurrentView('leaderboard')}
                size="small"
              >
                View Leaderboard
              </button>
            </vstack>
            <text size="small">A fun emoji guessing game or guess-a-word mode!</text>
          </vstack>
        );
      }
    } else if (currentView === 'game') {
      // MAIN GAME SCREEN
      content = (
        <vstack padding="small" gap="small" alignment="center" backgroundColor={backgroundColor}>
          <hstack width="100%" alignment="start top" gap="small">
            <button
              appearance="secondary"
              size="small"
              icon="back"
              onPress={() => setCurrentView('home')}
            >
              Back
            </button>
            <text style="heading" size="small">
              Score: {score}
            </text>
            <spacer />
            <text size="small">{heartsDisplay}</text>
          </hstack>
          <text style="heading" size="medium">
            Guess The Clue!
          </text>
          <text size="small">Current Category: {category}</text>
          <hstack gap="small">
            {Object.keys(categories).map((cat, index) => (
              <button
                key={index.toString()}
                onPress={() => changeCategory(cat)}
                appearance={category === cat ? 'primary' : 'secondary'}
                size="small"
              >
                {cat.charAt(0).toUpperCase() + cat.slice(1)}
              </button>
            ))}
          </hstack>
          <vstack padding="small" gap="small" border="thin" borderColor="neutral" cornerRadius="small">
            <text style="heading" size="small">
              Clue
            </text>
            <hstack gap="small" alignment="center">
              {currentItem &&
                categories[category][currentItem]
                  .slice(0, clueIndex + 1)
                  .map((emoji, index) => (
                    <text key={index.toString()} size="small">
                      {emoji}
                    </text>
                  ))}
            </hstack>
            <text size="xsmall">(Guess based on the clues above)</text>
            {clueIndex < categories[category][currentItem]?.length - 1 && (
              <button onPress={() => setClueIndex(clueIndex + 1)} size="small">
                Show Next Clue
              </button>
            )}
          </vstack>
          <vstack gap="small" width="100%">
            <hstack>
              <text size="small">Your guess: </text>
              <button onPress={() => context.ui.showForm(guessForm)} size="small">
                Enter guess
              </button>
            </hstack>
            {userGuess && <text size="small">Current guess: {userGuess}</text>}
            <button onPress={checkGuess} appearance="primary" disabled={wrongCount >= 5} size="small">
              Submit Guess
            </button>
          </vstack>
          {message && (
            <text color={message.includes('Correct') ? 'green' : 'red'} size="small">
              {message}
            </text>
          )}
          <text style="heading" size="small">
            Score: {score}
          </text>
          <button onPress={startNewRound} disabled={wrongCount >= 5} size="small">
            New Clue
          </button>
          <button onPress={() => setCurrentView('leaderboard')} size="small">
            Go to Leaderboard
          </button>
        </vstack>
      );
    } else if (currentView === 'wordit') {
      // WORDIT SCREEN (3 attempts, hearts shown)
      const worditHearts = getWordITHearts();
      content = (
        <vstack padding="small" gap="small" alignment="center" backgroundColor={backgroundColor}>
          <hstack width="100%" alignment="start top" gap="small">
            <button
              appearance="secondary"
              size="small"
              icon="back"
              onPress={() => setCurrentView('home')}
            >
              Back
            </button>
            <text style="heading" size="small">
              Score: {score}
            </text>
            <spacer />
            <text size="small">{worditHearts}</text>
          </hstack>
          <text style="heading" size="medium">
            WordIT Mode
          </text>
          {currentWord ? (
            <>
              {/* Show definitions */}
              {getWordITDefinitions().map((def, i) => (
                <text key={i.toString()} size="small">
                  Clue {i + 1}: {def}
                </text>
              ))}
              {/* Show revealed letters */}
              <text size="small">{revealedLetters.join(' ')}</text>

              <hstack gap="small">
                <text size="small">Attempt: {wordAttempt} / 3</text>
                <button
                  onPress={() => context.ui.showForm(wordITGuessForm)}
                  appearance="primary"
                  size="small"
                >
                  Enter Guess
                </button>
              </hstack>

              {userGuess && <text size="small">Current guess: {userGuess}</text>}
              {message && (
                <text color={message.includes('Correct') ? 'green' : 'red'} size="small">
                  {message}
                </text>
              )}
              <text size="small">Score: {score}</text>
            </>
          ) : (
            <text size="small">Loading word...</text>
          )}
        </vstack>
      );
    } else if (currentView === 'leaderboard') {
      // LEADERBOARD
      content = (
        <vstack padding="small" gap="small" alignment="center" backgroundColor={backgroundColor}>
          <hstack width="100%" alignment="start top" gap="small">
            <button
              appearance="secondary"
              size="small"
              icon="back"
              onPress={() => setCurrentView('home')}
            >
              Back
            </button>
            <text style="heading" size="medium">
              Leaderboard
            </text>
          </hstack>
          {leaderboard.length > 0 ? (
            leaderboard.map((entry, index) => (
              <hstack key={index.toString()} gap="small" alignment="center">
                <text style="heading" size="small">
                  {index + 1}.
                </text>
                <text size="small">{entry.member}</text>
                <spacer />
                <text style="heading" size="small">
                  {entry.score}
                </text>
              </hstack>
            ))
          ) : (
            <text size="small">No scores yet. Be the first!</text>
          )}
          <button onPress={() => setCurrentView('home')} appearance="primary" size="small">
            Back to Home
          </button>
        </vstack>
      );
    }

    return (
      <blocks height="tall">
        {content}
      </blocks>
    );
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
