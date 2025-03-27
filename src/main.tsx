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
    const [category, setCategory] = useState('cricket');
    const [currentItem, setCurrentItem] = useState('');
    const [clueIndex, setClueIndex] = useState(0);
    const [userGuess, setUserGuess] = useState('');
    const [message, setMessage] = useState('');
    const [score, setScore] = useState(0);
    const [showLeaderboard, setShowLeaderboard] = useState(false);
    const [leaderboard, setLeaderboard] = useState<Array<{member: string, score: number}>>([]);
    const [username, setUsername] = useState('');

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
          setLeaderboard(initialLeaderboard.filter((entry): entry is {member: string, score: number} =>
            typeof entry === 'object' && entry !== null && 'member' in entry && 'score' in entry
          ));
        } catch (error) {
          console.error('Error fetching leaderboard:', error);
        }
      };
      fetchLeaderboard();
      return null;
    });

    const channel = useChannel({
      name: 'leaderboard_updates',
      onMessage: (newLeaderboardEntry) => {
        const newLeaderboard = [...leaderboard, newLeaderboardEntry]
          .sort((a, b) => {
            // Ensure we're dealing with objects that have score property
            const scoreA = typeof a === 'object' && a !== null && 'score' in a ? Number(a.score) : 0;
            const scoreB = typeof b === 'object' && b !== null && 'score' in b ? Number(b.score) : 0;
            return scoreB - scoreA;
          })
          .slice(0, 5);
        
        setLeaderboard(newLeaderboard.filter((entry): entry is {member: string, score: number} =>
          typeof entry === 'object' && entry !== null && 'member' in entry && 'score' in entry
        ));
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

    const guessForm = useForm(
      {
        title: 'Enter your guess',
        fields: [{ name: 'guess', label: 'Your guess', type: 'string' }]
      },
      (values) => {
        setUserGuess(values.guess || '');
        setTimeout(() => checkGuess(), 100);
      }
    );

    const startNewRound = () => {
      const items = Object.keys(categories[category]);
      const randomItem = items[Math.floor(Math.random() * items.length)];
      setCurrentItem(randomItem);
      setClueIndex(0);
      setMessage('');
    };

    const checkGuess = async () => {
      if (userGuess.toLowerCase() === currentItem.toLowerCase()) {
        const pointsEarned = Math.max(1, 5 - clueIndex);
        setMessage(`Correct! You earned ${pointsEarned} point${pointsEarned > 1 ? 's' : ''}!`);
        const newScore = score + pointsEarned;
        setScore(newScore);
        if (username) await saveScore(username, newScore);
      } else {
        setMessage("Sorry, that's not correct. Try again!");
      }
      setUserGuess('');
    };

    if (!currentItem) {
      startNewRound();
    }

    const changeCategory = (newCategory: string) => {
      setCategory(newCategory);
      // Don't set currentItem to empty string
      // Instead, directly start a new round with the new category
      const items = Object.keys(categories[newCategory]);
      const randomItem = items[Math.floor(Math.random() * items.length)];
      setCurrentItem(randomItem);
      setClueIndex(0);
      setMessage('');
    };
    return (
      <blocks height="tall">
        <vstack padding="medium" gap="medium" alignment="center">
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
              {currentItem && categories[category][currentItem].slice(0, clueIndex + 1).map((emoji, index) => (
                <text key={index.toString()} size="xxlarge">{emoji}</text>
              ))}
            </hstack>
            <text>(Guess based on the emoji clues above)</text>
            {clueIndex < categories[category][currentItem]?.length - 1 && (
              <button onPress={() => setClueIndex(clueIndex + 1)}>Show Next Clue</button>
            )}
          </vstack>
          <vstack gap="small" width="100%">
            <hstack>
              <text>Your guess: </text>
              <button onPress={() => context.ui.showForm(guessForm)}>Enter guess</button>
            </hstack>
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
            <vstack padding="medium" gap="small" border="thin" borderColor="neutral" cornerRadius="medium" width="100%">
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