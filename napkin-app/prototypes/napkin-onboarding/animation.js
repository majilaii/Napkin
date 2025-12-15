// Restaurant data by city (expandable)
const restaurantsByCity = {
    london: [
        "Pizza Pilgrims",
        "Dishoom",
        "Padella",
        "Bao",
        "Flat Iron",
        "The Barbary",
        "Hoppers",
        "Gymkhana",
        "Kiln",
        "Smoking Goat",
        "Barrafina",
        "St. John",
        "Noble Rot",
        "Rochelle Canteen",
        "The River Cafe"
    ],
    newyork: [
        "Joe's Pizza",
        "Katz's Deli",
        "Momofuku",
        "Carbone",
        "Di Fara",
        "Russ & Daughters",
        "Peter Luger",
        "Le Bernardin",
        "Eleven Madison Park",
        "Via Carota",
        "L'Artusi",
        "Lilia",
        "Lucali",
        "Prince Street Pizza",
        "Gramercy Tavern"
    ],
    paris: [
        "Le Comptoir",
        "Septime",
        "Frenchie",
        "Bouillon Chartier",
        "L'Ami Jean",
        "Breizh Café",
        "Du Pain et des Idées",
        "Pierre Hermé",
        "Le Baratin",
        "Clown Bar",
        "Le Chateaubriand",
        "Chez L'Ami Louis",
        "Le Petit Cler",
        "Pink Mamma",
        "Café de Flore"
    ]
};

// Current city (would be detected from user location)
const currentCity = 'london';
const restaurants = restaurantsByCity[currentCity];

// Shuffle array helper
function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

// Track current ranking number
let currentRank = 1;

// Add a restaurant entry to the background as a ranked list item
function addRestaurantEntry(name, delay = 0) {
    const entriesContainer = document.getElementById('entries');
    const entry = document.createElement('div');
    entry.className = 'restaurant-entry';

    // Slight random rotation for handwritten feel (-2 to 2 degrees)
    const rotation = -2 + Math.random() * 4;
    entry.style.setProperty('--rotation', rotation + 'deg');

    // Create the numbered entry
    const rankSpan = document.createElement('span');
    rankSpan.className = 'rank';
    rankSpan.textContent = `${currentRank}.`;

    const nameSpan = document.createElement('span');
    nameSpan.className = 'name';
    nameSpan.textContent = ` ${name}`;

    entry.appendChild(rankSpan);
    entry.appendChild(nameSpan);

    entriesContainer.appendChild(entry);

    // Increment rank for next entry
    currentRank++;

    // Trigger animation after delay
    setTimeout(() => {
        entry.classList.add('visible');
    }, delay);

    return entry;
}

// Onboarding flow
const onboardingSteps = [
    {
        title: "Welcome to Napkin",
        description: "Your dining journal for memorable meals with the people you love.",
        button: "Get Started"
    },
    {
        title: "Track Your Favorites",
        description: "Rate restaurants, save memories, and build your personal dining history.",
        button: "Next"
    },
    {
        title: "Dine Together",
        description: "Share experiences with friends and discover their hidden gems.",
        button: "Let's Go!"
    }
];

let currentStep = 0;
const shuffledRestaurants = shuffleArray(restaurants);
let restaurantIndex = 0;

// Add initial background entries
function addInitialEntries() {
    // Add first 3 entries that appear to already be on the napkin
    for (let i = 0; i < 3; i++) {
        const name = shuffledRestaurants[restaurantIndex++];
        addRestaurantEntry(name, i * 300);
    }
}

// Update onboarding card content
function updateCard(step) {
    const card = document.querySelector('.onboarding-card');
    const title = card.querySelector('h1');
    const desc = card.querySelector('p');
    const btn = card.querySelector('.next-btn');
    const steps = card.querySelectorAll('.step');

    // Update step indicators
    steps.forEach((stepEl, i) => {
        stepEl.classList.remove('active', 'completed');
        if (i < step) stepEl.classList.add('completed');
        if (i === step) stepEl.classList.add('active');
    });

    // Animate content change
    card.style.transform = 'scale(0.98)';
    card.style.opacity = '0.8';

    setTimeout(() => {
        title.textContent = onboardingSteps[step].title;
        desc.textContent = onboardingSteps[step].description;
        btn.textContent = onboardingSteps[step].button;

        card.style.transform = 'scale(1)';
        card.style.opacity = '1';
    }, 150);
}

// Handle next button click
function handleNext() {
    // Add new restaurant entries on each step
    const entriesToAdd = 2 + Math.floor(Math.random() * 2); // 2-3 entries
    for (let i = 0; i < entriesToAdd; i++) {
        if (restaurantIndex < shuffledRestaurants.length) {
            addRestaurantEntry(shuffledRestaurants[restaurantIndex++], i * 400);
        }
    }

    currentStep++;

    if (currentStep < onboardingSteps.length) {
        updateCard(currentStep);
    } else {
        // Onboarding complete!
        completeOnboarding();
    }
}

// Complete onboarding animation
function completeOnboarding() {
    const card = document.querySelector('.onboarding-card');
    card.classList.add('completed');

    // Add a bunch more entries for the finale
    for (let i = 0; i < 4; i++) {
        if (restaurantIndex < shuffledRestaurants.length) {
            addRestaurantEntry(shuffledRestaurants[restaurantIndex++], i * 200);
        }
    }

    // Transition to home screen
    setTimeout(() => {
        // Create and show home screen
        const homeScreen = document.createElement('div');
        homeScreen.className = 'home-screen';
        homeScreen.innerHTML = '<h1>🍽️ Welcome Home!</h1>';
        document.body.appendChild(homeScreen);

        setTimeout(() => {
            homeScreen.classList.add('visible');
        }, 100);
    }, 800);
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    const nextBtn = document.getElementById('nextBtn');
    nextBtn.addEventListener('click', handleNext);

    // Add initial entries after a short delay
    setTimeout(addInitialEntries, 500);
});
