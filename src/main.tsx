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

// Black background for all pages
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

  // 4-lives system for the main game
  const [wrongCount, setWrongCount] = useState(0);
  // Track the last puzzle index so we don’t pick the same puzzle in a row
  const [lastPuzzleIndex, setLastPuzzleIndex] = useState<number | null>(null);

  // WordIT states
  const [currentWord, setCurrentWord] = useState<WordItem | null>(null);
  const [wordAttempt, setWordAttempt] = useState(1);
  const [revealedLetters, setRevealedLetters] = useState<string[]>([]);
  // Similarly track the last WordIT puzzle index
  const [lastWordIndex, setLastWordIndex] = useState<number | null>(null);

  // ============================
  // On load, fetch user
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
  // Category Game (4 lives)
  // ============================
  const pickNewCategoryPuzzle = (cat: string): number => {
    const items = Object.keys(categories[cat]);
    if (items.length === 0) return -1;
    // Avoid picking the same puzzle index as lastPuzzleIndex
    let newIndex = Math.floor(Math.random() * items.length);
    if (lastPuzzleIndex !== null && items.length > 1) {
      while (newIndex === lastPuzzleIndex) {
        newIndex = Math.floor(Math.random() * items.length);
      }
    }
    setLastPuzzleIndex(newIndex);
    // Return newIndex
    return newIndex;
  };

  const startNewRound = () => {
    setWrongCount(0);
    setUserGuess('');
    setMessage('');
    setClueIndex(0);
    // Pick puzzle
    const items = Object.keys(categories[category]);
    if (items.length === 0) return;
    const newIndex = pickNewCategoryPuzzle(category);
    if (newIndex >= 0) {
      const randomItem = items[newIndex];
      setCurrentItem(randomItem);
    }
  };

  const checkGuess = async () => {
    if (!currentItem) return;
    if (userGuess.trim().toLowerCase() === currentItem.toLowerCase()) {
      // Correct => auto-advance after 1.5s
      const pointsEarned = Math.max(1, 5 - clueIndex);
      setMessage(`Correct! You earned ${pointsEarned} point${pointsEarned > 1 ? 's' : ''}!`);
      const newScore = score + pointsEarned;
      setScore(newScore);
      if (username) await saveScore(username, newScore);

      // Auto-advance
      setTimeout(() => {
        startNewRound();
      }, 1500);
    } else {
      // Wrong
      const newWrong = wrongCount + 1;
      setWrongCount(newWrong);
      if (newWrong >= 4) {
        // Out of 4 lives
        setMessage(`You have been eliminated! The correct answer was: ${currentItem}`);
        setTimeout(() => {
          startNewRound();
        }, 1500);
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
    // pick puzzle
    let newIndex = Math.floor(Math.random() * items.length);
    if (lastPuzzleIndex !== null && items.length > 1) {
      while (newIndex === lastPuzzleIndex) {
        newIndex = Math.floor(Math.random() * items.length);
      }
    }
    setLastPuzzleIndex(newIndex);
    const randomItem = items[newIndex];
    setCurrentItem(randomItem);
  };

  // ============================
  // WordIT Logic
  // ============================
  const pickNewWordITPuzzle = (): number => {
    if (words.length === 0) return -1;
    let newIndex = Math.floor(Math.random() * words.length);
    if (lastWordIndex !== null && words.length > 1) {
      while (newIndex === lastWordIndex) {
        newIndex = Math.floor(Math.random() * words.length);
      }
    }
    setLastWordIndex(newIndex);
    return newIndex;
  };

  const startWordITRound = () => {
    setWordAttempt(1);
    setUserGuess('');
    setMessage('');
    // pick puzzle
    const newIndex = pickNewWordITPuzzle();
    if (newIndex >= 0) {
      const chosen = words[newIndex];
      setCurrentWord(chosen);
      const underscores = chosen.word.split('').map(() => '_');
      setRevealedLetters(underscores);
    }
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
      // correct
      const attempt = wordAttempt;
      const pointsEarned = Math.max(1, 4 - attempt); // attempt=1->3,2->2,3->1
      setMessage(`Correct! You earned ${pointsEarned} point${pointsEarned > 1 ? 's' : ''}.`);
      const newScore = score + pointsEarned;
      setScore(newScore);
      if (username) await saveScore(username, newScore);

      setTimeout(() => {
        startWordITRound();
      }, 1500);
    } else {
      // wrong
      const nextAttempt = wordAttempt + 1;
      setWordAttempt(nextAttempt);
      if (nextAttempt > 3) {
        setMessage(`No more attempts! The correct word was: ${currentWord.word}.`);
        setTimeout(() => {
          startWordITRound();
        }, 1500);
      } else {
        setMessage('Sorry, try again!');
        revealRandomLetter();
      }
    }
    setUserGuess('');
  };

  // If we haven't picked a puzzle yet, do so
  if (!currentItem && showHome === false && !showWordIt) {
    startNewRound();
  }

  // ============================
  // Rendering
  // ============================
  let content;
  if (showHome) {
    // HOME
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
              startWordITRound();
            }}
            size="large"
          >
            Play WordIT
          </button>
          <button
            appearance="secondary"
            onPress={() => {
              setShowLeaderboard(true);
              setShowHome(false);
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
    // WORDIT
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
          <text style="heading">Score: {score}</text>
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
            <button onPress={() => context.ui.showForm(wordITGuessForm)}>Enter Guess</button>
            {userGuess && <text>Current guess: {userGuess}</text>}
            <button onPress={checkWordITGuess} appearance="primary">
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
  } else {
    // Category game UI
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
          <text style="heading">Score: {score}</text>
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
          <hstack gap="medium" alignment="center">
            {currentItem &&
              categories[category][currentItem].slice(0, clueIndex + 1).map((emoji, index) => (
                <text key={index.toString()} size="xxlarge">{emoji}</text>
              ))}
          </hstack>
          <text>(Guess based on the clues above)</text>
          {clueIndex < categories[category][currentItem]?.length - 1 && (
            <button onPress={() => setClueIndex(clueIndex + 1)}>Show Next Clue</button>
          )}
        </vstack>
        <vstack gap="small" width="100%">
          <button onPress={() => context.ui.showForm(guessForm)}>Enter guess</button>
          {userGuess && <text>Current guess: {userGuess}</text>}
          <button onPress={checkGuess} appearance="primary">Submit Guess</button>
        </vstack>
        {message && <text color={message.includes('Correct') ? 'green' : 'red'}>{message}</text>}
        <text style="heading">Score: {score}</text>
        <button onPress={startNewRound}>New Clue</button>
        <button onPress={() => setShowLeaderboard(!showLeaderboard)}>
          {showLeaderboard ? 'Hide Leaderboard' : 'Show Leaderboard'}
        </button>
        {showLeaderboard && (
          <vstack
            padding="medium"
            gap="small"
            border="thin"
            borderColor="neutral"
            cornerRadius="medium"
            width="100%"
          >
            <text style="heading" size="large">Leaderboard</text>
            {leaderboard.length > 0 ? (
              leaderboard.map((entry, index) => (
                <hstack key={index.toString()} gap="medium" alignment="center">
                  <text style="heading" size="small">{index + 1}.</text>
                  <text>{entry.member}</text>
                  <spacer />
                  <text style="heading">{entry.score}</text>
                </hstack>
              ))
            ) : (
              <text>No scores yet. Be the first!</text>
            )}
          </vstack>
        )}
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
