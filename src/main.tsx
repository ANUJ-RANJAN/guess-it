import { Devvit, useState, useForm } from '@devvit/public-api';
Devvit.configure({
  redis: true,
  redditAPI: true,
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
    const checkGuess = () => {
      if (userGuess.toLowerCase() === currentItem.toLowerCase()) {
        setMessage('Correct! You earned a point!');
        setScore(Number(score) + 1);
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