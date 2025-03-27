import { Devvit, useState, useForm, useChannel } from '@devvit/public-api';
import categoriesData from './categories.json' with { type: 'json' };

Devvit.configure({
  redis: true,
  redditAPI: true,
  realtime: true,
});

// TypeScript type for categories
type Categories = Record<string, Record<string, string[]>>;

const categories: Categories = categoriesData;

Devvit.addCustomPostType({
  name: 'GuessIT',
  description: 'A fun guessing game with different categories',
  render: (context) => {
    // Game state
    const [category, setCategory] = useState('cricket');
    const [currentItem, setCurrentItem] = useState('');
    const [clueIndex, setClueIndex] = useState(0);
    const [userGuess, setUserGuess] = useState('');
    const [message, setMessage] = useState('');
    const [score, setScore] = useState(0);
    const [leaderboard, setLeaderboard] = useState<Array<{ member: string; score: number }>>([]);
    const [username, setUsername] = useState('');
    // currentView can be 'home', 'game', or 'leaderboard'
    const [currentView, setCurrentView] = useState<'home' | 'game' | 'leaderboard'>('home');
    // Track wrong answers
    const [wrongCount, setWrongCount] = useState(0);
    // Flag to indicate game over (elimination)
    const [eliminated, setEliminated] = useState(false);

    // Background gradient style: light black to a blackish white.
    const getBackgroundStyle = () => {
      return { background: 'linear-gradient(135deg, #333, #ccc)' };
    };

    // Get current user on load
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

    // Leaderboard retrieval function
    const getLeaderboard = async () => {
      return await context.redis.zRange('leaderboard', 0, 4, {
        reverse: true,
        by: 'score',
      });
    };

    // Fetch leaderboard on load
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

    // Listen for realtime leaderboard updates
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

    // Save the player's score to the leaderboard
    const saveScore = async (playerUsername: string, gameScore: number) => {
      try {
        await context.redis.zAdd('leaderboard', { member: playerUsername, score: gameScore });
        context.realtime.send('leaderboard_updates', { member: playerUsername, score: gameScore });
      } catch (error) {
        console.error('Error saving score:', error);
      }
    };

    // Form for entering a name
    const nameForm = useForm(
      {
        title: 'Enter your name',
        fields: [
          {
            name: 'username',
            label: 'Your Name',
            type: 'string',
          },
        ],
        acceptLabel: 'Save',
      },
      (values) => {
        setUsername(values.username || `Guest-${Math.floor(Math.random() * 10000)}`);
        context.ui.showToast(`Welcome, ${values.username || 'Guest'}!`);
      }
    );

    // Form for entering a guess
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

    // Start a new round; only if player is not eliminated
    const startNewRound = () => {
      if (wrongCount >= 5) return;
      const items = Object.keys(categories[category]);
      const randomItem = items[Math.floor(Math.random() * items.length)];
      setCurrentItem(randomItem);
      setClueIndex(0);
      setMessage('');
    };

    // Check the guess and update wrong answer count if needed
    const checkGuess = async () => {
      if (wrongCount >= 5) return; // Already eliminated
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
          // Re-fetch leaderboard to update it
          const updatedLeaderboard = await getLeaderboard();
          setLeaderboard(
            updatedLeaderboard.filter(
              (entry): entry is { member: string; score: number } =>
                typeof entry === 'object' && entry !== null && 'member' in entry && 'score' in entry
            )
          );
          // After a short delay, switch to Game Over view
          setTimeout(() => {
            setEliminated(true);
            setCurrentView('home');
          }, 2000);
        } else {
          setMessage("Sorry, that's not correct. Try again!");
        }
      }
      setUserGuess('');
    };

    // Change the category and start a new round
    const changeCategory = (newCategory: string) => {
      setCategory(newCategory);
      const items = Object.keys(categories[newCategory]);
      const randomItem = items[Math.floor(Math.random() * items.length)];
      setCurrentItem(randomItem);
      setClueIndex(0);
      setMessage('');
    };

    // Calculate hearts display for lives remaining
    const totalLives = 5;
    const livesRemaining = Math.max(0, totalLives - wrongCount);
    const heartsDisplay = '❤️'.repeat(livesRemaining) + '♡'.repeat(totalLives - livesRemaining);

    // Render content based on current view
    let content;
    if (currentView === 'home') {
      // Home screen: if eliminated, show final score and a Home button; otherwise, show main menu.
      if (eliminated) {
        content = (
          <vstack padding="medium" gap="large" alignment="center">
            <text style="heading" size="xxlarge">
              Game Over
            </text>
            <text>Your final score: {score}</text>
            <button
              appearance="primary"
              onPress={() => {
                // Reset game state and start a new game
                setEliminated(false);
                setScore(0);
                setWrongCount(0);
                setCurrentView('game');
                startNewRound();
              }}
              size="large"
            >
              Play Again
            </button>
            <button
              appearance="secondary"
              onPress={() => setCurrentView('leaderboard')}
              size="large"
            >
              View Leaderboard
            </button>
            {/* A Home button so user can manually return to the main menu */}
            <button
              appearance="secondary"
              onPress={() => {
                setEliminated(false);
                setScore(0);
                setWrongCount(0);
                setCurrentView('home');
              }}
              size="large"
            >
              Home
            </button>
          </vstack>
        );
      } else {
        content = (
          <vstack padding="medium" gap="large" alignment="center">
            <text style="heading" size="xxlarge">
              GuessIT
            </text>
            <image
              url="logo.png"
              imageWidth={150}
              imageHeight={150}
              description="GuessIT game logo"
            />
            <vstack gap="medium" width="80%">
              <button appearance="primary" onPress={() => context.ui.showForm(nameForm)}>
                Enter Your Name
              </button>
              <text>{username ? `Playing as: ${username}` : 'No name entered yet'}</text>
              <button
                appearance="primary"
                onPress={() => {
                  if (!username) {
                    setUsername(`Guest-${Math.floor(Math.random() * 10000)}`);
                  }
                  // Reset game values before starting
                  setScore(0);
                  setWrongCount(0);
                  setEliminated(false);
                  setCurrentView('game');
                  startNewRound();
                }}
                size="large"
              >
                Start Game
              </button>
              <button
                appearance="secondary"
                onPress={() => setCurrentView('leaderboard')}
                size="large"
              >
                View Leaderboard
              </button>
            </vstack>
            <text size="small">A fun emoji guessing game!</text>
          </vstack>
        );
      }
    } else if (currentView === 'game') {
      // Game screen with back button on top left and hearts (lives) on top right.
      content = (
        <vstack padding="medium" gap="medium" alignment="center" style={getBackgroundStyle()}>
          <hstack width="100%" alignment="start top" gap="medium">
            <button
              appearance="secondary"
              size="small"
              icon="back"
              onPress={() => setCurrentView('home')}
            >
              Back
            </button>
            <text style="heading">Score: {score}</text>
            <spacer />
            <text>{heartsDisplay}</text>
          </hstack>
          <text style="heading" size="xlarge">
            Guess The Clue!
          </text>
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
            <text style="heading" size="large">
              Clue
            </text>
            <hstack gap="medium" alignment="center">
              {currentItem &&
                categories[category][currentItem]
                  .slice(0, clueIndex + 1)
                  .map((emoji, index) => (
                    <text key={index.toString()} size="xxlarge">
                      {emoji}
                    </text>
                  ))}
            </hstack>
            <text>(Guess based on the clues above)</text>
            {clueIndex < categories[category][currentItem]?.length - 1 && (
              <button onPress={() => setClueIndex(clueIndex + 1)}>
                Show Next Clue
              </button>
            )}
          </vstack>
          <vstack gap="small" width="100%">
            <hstack>
              <text>Your guess: </text>
              <button onPress={() => context.ui.showForm(guessForm)}>
                Enter guess
              </button>
            </hstack>
            {userGuess && <text>Current guess: {userGuess}</text>}
            <button onPress={checkGuess} appearance="primary" disabled={wrongCount >= 5}>
              Submit Guess
            </button>
          </vstack>
          {message && (
            <text color={message.includes('Correct') ? 'green' : 'red'}>
              {message}
            </text>
          )}
          <text style="heading">Score: {score}</text>
          <button onPress={startNewRound} disabled={wrongCount >= 5}>
            New Clue
          </button>
          <button onPress={() => setCurrentView('leaderboard')}>
            Go to Leaderboard
          </button>
        </vstack>
      );
    } else if (currentView === 'leaderboard') {
      // Leaderboard screen with back button on top left.
      content = (
        <vstack padding="medium" gap="medium" alignment="center" style={getBackgroundStyle()}>
          <hstack width="100%" alignment="start top" gap="medium">
            <button
              appearance="secondary"
              size="small"
              icon="back"
              onPress={() => setCurrentView('home')}
            >
              Back
            </button>
            <text style="heading">Leaderboard</text>
          </hstack>
          {leaderboard.length > 0 ? (
            leaderboard.map((entry, index) => (
              <hstack key={index.toString()} gap="medium" alignment="center">
                <text style="heading" size="small">
                  {index + 1}.
                </text>
                <text>{entry.member}</text>
                <spacer />
                <text style="heading">{entry.score}</text>
              </hstack>
            ))
          ) : (
            <text>No scores yet. Be the first!</text>
          )}
          <button onPress={() => setCurrentView('home')} appearance="primary">
            Back to Home
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
