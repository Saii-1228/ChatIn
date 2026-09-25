// Firebase v10 SDK Imports
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.4.0/firebase-app.js";
import { 
    getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, 
    onAuthStateChanged, signOut, updateProfile 
} from "https://www.gstatic.com/firebasejs/10.4.0/firebase-auth.js";
import { 
    getFirestore, collection, addDoc, query, orderBy, onSnapshot, 
    serverTimestamp, doc, setDoc, getDocs, where, getDoc 
} from "https://www.gstatic.com/firebasejs/10.4.0/firebase-firestore.js";

// ==========================================
// 1. FIREBASE CONFIGURATION
// Replace this object with your Firebase keys
// ==========================================
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT_ID.appspot.com",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Global State
let currentUser = null;
let currentChatId = null;
let currentChatUser = null;
let unsubscribeMessages = null;

// ==========================================
// 2. DOM ELEMENTS
// ==========================================
// Auth Elements
const authScreen = document.getElementById('auth-screen');
const appScreen = document.getElementById('app-screen');
const authForm = document.getElementById('auth-form');
const authNameInput = document.getElementById('auth-name');
const authEmailInput = document.getElementById('auth-email');
const authPasswordInput = document.getElementById('auth-password');
const authBtn = document.getElementById('auth-btn');
const authSwitchBtn = document.getElementById('auth-switch-btn');
const authSwitchText = document.getElementById('auth-switch-text');
const authError = document.getElementById('auth-error');

// App Elements
const logoutBtn = document.getElementById('logout-btn');
const currentUserNameHeader = document.getElementById('current-user-name');
const contactsList = document.getElementById('contacts-list');
const searchInput = document.getElementById('user-search-input');

// Chat Elements
const emptyChatState = document.getElementById('empty-chat-state');
const activeChatInterface = document.getElementById('active-chat-interface');
const chatWindow = document.getElementById('chat-window');
const activeChatName = document.getElementById('active-chat-name');
const activeChatAvatar = document.getElementById('active-chat-avatar');
const messagesContainer = document.getElementById('messages-container');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const mobileBackBtn = document.getElementById('mobile-back-btn');

// ==========================================
// 3. AUTHENTICATION LOGIC
// ==========================================
let isLoginMode = true;

authSwitchBtn.addEventListener('click', () => {
    isLoginMode = !isLoginMode;
    if (isLoginMode) {
        authNameInput.classList.add('hidden');
        authBtn.textContent = 'Log In';
        authSwitchText.textContent = "Don't have an account?";
        authSwitchBtn.textContent = 'Sign up';
    } else {
        authNameInput.classList.remove('hidden');
        authBtn.textContent = 'Sign Up';
        authSwitchText.textContent = "Already have an account?";
        authSwitchBtn.textContent = 'Log in';
    }
    authError.textContent = '';
});

authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = authEmailInput.value;
    const password = authPasswordInput.value;
    const name = authNameInput.value;

    try {
        if (isLoginMode) {
            await signInWithEmailAndPassword(auth, email, password);
        } else {
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            await updateProfile(userCredential.user, { displayName: name });
            // Save user to Firestore
            await setDoc(doc(db, "users", userCredential.user.uid), {
                uid: userCredential.user.uid,
                name: name,
                email: email,
                avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=005cff&color=fff`
            });
        }
    } catch (error) {
        authError.textContent = error.message.replace('Firebase: ', '');
    }
});

logoutBtn.addEventListener('click', () => {
    signOut(auth);
});

// Auth State Observer
onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        authScreen.classList.add('hidden');
        appScreen.classList.remove('hidden');
        currentUserNameHeader.textContent = user.displayName || 'Messages';
        loadUsers();
    } else {
        currentUser = null;
        appScreen.classList.add('hidden');
        authScreen.classList.remove('hidden');
        resetChatState();
    }
});

// ==========================================
// 4. USERS & CHAT LIST LOGIC
// ==========================================
async function loadUsers(searchQuery = '') {
    const usersRef = collection(db, "users");
    const q = query(usersRef);
    const querySnapshot = await getDocs(q);
    
    contactsList.innerHTML = '';
    
    querySnapshot.forEach((doc) => {
        const userData = doc.data();
        // Don't show current user in the list
        if (userData.uid === currentUser.uid) return;
        
        // Basic search filtering
        if (searchQuery && !userData.name.toLowerCase().includes(searchQuery.toLowerCase())) return;

        const contactEl = document.createElement('div');
        contactEl.classList.add('contact-item');
        contactEl.innerHTML = `
            <img src="${userData.avatar}" alt="${userData.name}" class="contact-avatar">
            <div class="contact-info">
                <div class="contact-name">${userData.name}</div>
                <div class="contact-last-msg">Click to start chatting</div>
            </div>
        `;
        
        contactEl.addEventListener('click', () => openChat(userData));
        contactsList.appendChild(contactEl);
    });
}

searchInput.addEventListener('input', (e) => {
    loadUsers(e.target.value);
});

// ==========================================
// 5. ACTIVE CHAT LOGIC
// ==========================================
async function openChat(targetUser) {
    currentChatUser = targetUser;
    
    // UI Updates
    emptyChatState.classList.add('hidden');
    activeChatInterface.classList.remove('hidden');
    activeChatName.textContent = targetUser.name;
    activeChatAvatar.src = targetUser.avatar;
    
    // Mobile layout toggle
    chatWindow.classList.add('active-mobile');

    // Generate a unique Chat ID based on both UIDs
    currentChatId = currentUser.uid > targetUser.uid 
        ? currentUser.uid + "_" + targetUser.uid 
        : targetUser.uid + "_" + currentUser.uid;

    loadMessages();
}

function loadMessages() {
    if (unsubscribeMessages) unsubscribeMessages();
    
    messagesContainer.innerHTML = '';
    
    const messagesRef = collection(db, "chats", currentChatId, "messages");
    const q = query(messagesRef, orderBy("timestamp", "asc"));

    unsubscribeMessages = onSnapshot(q, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === "added") {
                renderMessage(change.doc.data());
            }
        });
        scrollToBottom();
    });
}

function renderMessage(data) {
    const msgEl = document.createElement('div');
    msgEl.classList.add('message');
    
    if (data.senderId === currentUser.uid) {
        msgEl.classList.add('sent');
    } else {
        msgEl.classList.add('received');
    }
    
    msgEl.textContent = data.text;
    messagesContainer.appendChild(msgEl);
}

// ==========================================
// 6. SENDING MESSAGES
// ==========================================
async function sendMessage() {
    const text = messageInput.value.trim();
    if (!text || !currentChatId) return;

    messageInput.value = '';
    sendBtn.classList.add('hidden');

    const messagesRef = collection(db, "chats", currentChatId, "messages");
    
    try {
        await addDoc(messagesRef, {
            text: text,
            senderId: currentUser.uid,
            timestamp: serverTimestamp()
        });
    } catch (error) {
        console.error("Error sending message:", error);
    }
}

// Input Event Listeners
messageInput.addEventListener('input', () => {
    if (messageInput.value.trim().length > 0) {
        sendBtn.classList.remove('hidden');
    } else {
        sendBtn.classList.add('hidden');
    }
});

messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendMessage();
    }
});

sendBtn.addEventListener('click', sendMessage);

// ==========================================
// 7. UTILITIES & UI INTERACTIONS
// ==========================================
function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function resetChatState() {
    currentChatId = null;
    currentChatUser = null;
    if (unsubscribeMessages) unsubscribeMessages();
    emptyChatState.classList.remove('hidden');
    activeChatInterface.classList.add('hidden');
    chatWindow.classList.remove('active-mobile');
}

mobileBackBtn.addEventListener('click', () => {
    chatWindow.classList.remove('active-mobile');
});
