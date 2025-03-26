import { Devvit, useState, useForm, useChannel } from '@devvit/public-api';
Devvit.configure({
  redis: true,
  redditAPI: true,
  realtime: true, // Added realtime for leaderboard updates
  // Include any other capabilities you need here
});
// Define categories and their items
const categories: Record<string, string[]> = {
  cricket: ['Virat Kohli', 'MS Dhoni', 'Rohit Sharma', 'Jasprit Bumrah'],
  football: ['Lionel Messi', 'Cristiano Ronaldo', 'Neymar Jr', 'Kylian Mbappe'],
  movies: ['Inception', 'The Godfather', 'Pulp Fiction', 'The Dark Knight'],
};

// Custom post type for the game
Devvit.addCustomPostType({
  name: 'Guess The Clue',
  description: 'A fun guessing game with different categories',
  render: (context) => {
    // Use useState directly from import, not from context
    const [category, setCategory] = useState('cricket');
    const [currentItem, setCurrentItem] = useState('');
    const [userGuess, setUserGuess] = useState('');
    const [message, setMessage] = useState('');
    const [score, setScore] = useState(0);
    const [showLeaderboard, setShowLeaderboard] = useState(false);
    const [leaderboard, setLeaderboard] = useState<Array<{member: string, score: number}>>([]);
    const [username, setUsername] = useState('');
    
    // Get current user on initial render
    useState(() => {
      const fetchUser = async () => {
        try {
          const currentUser = await context.reddit.getCurrentUser();
          if (currentUser) {
            setUsername(currentUser.username);
          }
        } catch (error) {
          console.error('Error getting current user:', error);
        }
      };
      fetchUser();
      return null; // Return a JSON-serializable value
    });
    
    // Function to fetch the leaderboard
    const getLeaderboard = async () => {
      return await context.redis.zRange('leaderboard', 0, 4, {
        reverse: true,
        by: 'score',
      });
    };
    
    // Initialize leaderboard on first render
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
      return null; // Return a JSON-serializable value
    });
    
    // Set up realtime channel for leaderboard updates
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
          .slice(0, 5); // leave top 5
        
        setLeaderboard(newLeaderboard.filter((entry): entry is {member: string, score: number} => 
          typeof entry === 'object' && entry !== null && 'member' in entry && 'score' in entry
        ));
      },
    });
    
    // Subscribe to the channel
    channel.subscribe();
    
    // Function to save score to Redis
    const saveScore = async (playerUsername: string, gameScore: number) => {
      try {
        // Add the score to the leaderboard sorted set
        await context.redis.zAdd('leaderboard', { member: playerUsername, score: gameScore });
        
        // Update the leaderboard for all active sessions using realtime
        context.realtime.send('leaderboard_updates', { member: playerUsername, score: gameScore });
      } catch (error) {
        console.error('Error saving score:', error);
      }
    };
    
    // Create a form using useForm hook
    const guessForm = useForm(
      {
        title: "Enter your guess",
        fields: [
          {
            name: "guess",
            label: "Your guess",
            type: "string"
          }
        ]
      },
      (values) => {
        setUserGuess(values.guess || '');
        setTimeout(() => checkGuess(), 100);
      }
    );
    
    // Function to start a new round
    const startNewRound = () => {
      const items = categories[category as keyof typeof categories];
      const randomItem = items[Math.floor(Math.random() * items.length)];
      setCurrentItem(randomItem);
      setMessage('');
    };
    
    // Function to check the user's guess
    const checkGuess = async () => {
      if (userGuess.toLowerCase() === currentItem.toLowerCase()) {
        setMessage('Correct! You earned a point!');
        const newScore = Number(score) + 1;
        setScore(newScore);
        
        // Save score to leaderboard if user is logged in
        if (username) {
          await saveScore(username, newScore);
        }
      } else {
        setMessage('Sorry, that\'s not correct. Try again!');
      }
      setUserGuess('');
    };
    
    // Initialize game if no current item
    if (!currentItem) {
      startNewRound();
    }
    
    // Function to change category
    const changeCategory = (newCategory: string) => {
      setCategory(newCategory);
      startNewRound();
    };
    
    return (
      <blocks height="tall">
        <vstack padding="medium" gap="medium" alignment="center">
          <text style="heading" size="xlarge">Guess The Clue!</text>
          
          <text>Current Category: {category}</text>
          
          <hstack gap="medium">
            <button 
              onPress={() => changeCategory('cricket')}
              appearance={category === 'cricket' ? 'primary' : 'secondary'}
            >
              Cricket
            </button>
            <button 
              onPress={() => changeCategory('football')}
              appearance={category === 'football' ? 'primary' : 'secondary'}
            >
              Football
            </button>
            <button 
              onPress={() => changeCategory('movies')}
              appearance={category === 'movies' ? 'primary' : 'secondary'}
            >
              Movies
            </button>
          </hstack>
          
          <vstack padding="medium" gap="medium" border="thin" borderColor="neutral" cornerRadius="medium">
            <text style="heading" size="large">Clue</text>
            {/* This is where you would show your visual clue */}
            <text>Imagine a visual representation of: {currentItem}</text>
            <text>(In a real implementation, this would be a drawing or visual clue)</text>
          </vstack>
          
          <vstack gap="small" width="100%">
            <hstack>
              <text>Your guess: </text>
              <button onPress={() => context.ui.showForm(guessForm)}>
                Enter guess
              </button>
            </hstack>
            
            {userGuess && <text>Current guess: {userGuess}</text>}
            
            <button
              onPress={checkGuess}
              appearance="primary"
            >
              Submit Guess
            </button>
          </vstack>
          
          {message && (
            <text color={message.includes('Correct') ? 'green' : 'red'}>
              {message}
            </text>
          )}
          
          <text style="heading">Score: {score}</text>
          
          <button
            onPress={startNewRound}
          >
            New Clue
          </button>
          
          <button
            onPress={() => setShowLeaderboard(!showLeaderboard)}
          >
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

// Add a menu item to create the game post
Devvit.addMenuItem({
  location: 'subreddit',
  label: 'Create Guessing Game',
  onPress: async (_, context) => {
    const currentSubreddit = await context.reddit.getCurrentSubreddit();
    await context.reddit.submitPost({
      title: 'Guess The Clue Game',
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