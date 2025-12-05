// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, updatePassword } from "firebase/auth";
import { getFirestore, doc, collection, onSnapshot, setDoc, query, updateDoc, deleteDoc, writeBatch } from "firebase/firestore";
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'; 
import { Clock, CheckCircle, XCircle, Plus, LayoutDashboard, Calendar, User, List, Trash2, RotateCcw, Timer, BookOpen, Edit, ChevronRight, BarChart3, Lock, Sun, Moon, Repeat, ChevronLeft, LogOut, MoreVertical, Dices, ArrowUpDown, Filter } from 'lucide-react';

// --- Firebase Configuration ---
const firebaseConfig = {
  apiKey: "AIzaSyBQClGa9ETCMXWejXWuBTlTZB8T584MFus", 
  authDomain: "spaced-revison-mynew08923.firebaseapp.com",
  projectId: "spaced-revison-mynew08923",
  storageBucket: "spaced-revison-mynew08923.firebasestorage.app",
  appId: "1:667074025327:web:9d1d38a6bf29edfcbe7a9a",
  messagingSenderId: "667074025327",
  measurementId: "G-HVBG4S9F42"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Helper function for exponential backoff
const exponentialBackoff = async (fn, maxRetries = 5, delay = 1000) => {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn();
        } catch (error) {
            if (i === maxRetries - 1) throw error;
            console.warn(`Retry attempt ${i + 1} failed. Retrying in ${delay}ms.`, error.message);
            await new Promise(resolve => setTimeout(resolve, delay));
            delay *= 2;
        }
    }
};

// --- Firestore Helpers ---
const getTopicsCollection = (userId) => collection(db, `artifacts/spaced-revision/users/${userId}/revision_topics`);
const getRevisionSubjectsCollection = (userId) => collection(db, `artifacts/spaced-revision/users/${userId}/revision_subjects`);
const getTaskSubjectsCollection = (userId) => collection(db, `artifacts/spaced-revision/users/${userId}/task_subjects`);
const getUserDocRef = (userId) => doc(db, `artifacts/spaced-revision/users/${userId}/profile/data`);

// --- Date Utilities ---
const today = () => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date;
};

const TODAY_MS = (() => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date.getTime();
})();

const TOMORROW_MS = TODAY_MS + (1000 * 60 * 60 * 24);
const DAY_AFTER_TOMORROW_MS = TOMORROW_MS + (1000 * 60 * 60 * 24);
const START_OF_WEEK_MS = TODAY_MS - today().getDay() * (1000 * 60 * 60 * 24);
const END_OF_WEEK_MS = START_OF_WEEK_MS + (7 * 24 * 60 * 60 * 1000) - 1;

const dateToString = (date) => {
    if (!date) return 'N/A';
    const d = date.toDate ? date.toDate() : new Date(date);
    if (isNaN(d.getTime())) return 'Invalid Date';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const dateToISOString = (date) => {
    if (!date) return '';
    const d = date.toDate ? date.toDate() : new Date(date);
    if (isNaN(d.getTime())) return '';
    return d.toISOString().split('T')[0];
};

// --- Revision Logic ---
const REVISION_SCHEDULE = [1, 3, 7, 15, 30];
const LONG_TERM_REVIEW_INTERVAL = 45;

const generateSchedule = (initialDate, enableLongTermReview = false) => {
    const initial = initialDate.toDate ? initialDate.toDate() : initialDate;
    
    let schedule = REVISION_SCHEDULE.map(days => {
        const targetDate = new Date(initial);
        targetDate.setDate(initial.getDate() + days);
        targetDate.setHours(0, 0, 0, 0);
        
        return {
            targetDate: targetDate.getTime(),
            completed: false,
            interval: days,
        }
    });

    if (enableLongTermReview) {
        schedule.push({
            targetDate: Infinity,
            completed: false,
            interval: LONG_TERM_REVIEW_INTERVAL,
            isLongTerm: true,
        });
    }

    return schedule;
};

const getStatusText = (currentRevision, totalRevisions, type, nextRevisionDate, revisionInterval) => {
    if (type === 'task') {
        return 'Study Task';
    }
    if (type === 'periodic') {
        if (!nextRevisionDate || isNaN(new Date(nextRevisionDate).getTime())) return 'No Next Revision';
        const targetDate = nextRevisionDate;
        const date = new Date(targetDate);
        if (targetDate < TODAY_MS) {
            return `Missed: Due ${dateToString(date)}`;
        } else if (targetDate === TODAY_MS) {
            return 'Due Today';
        } else {
            return `Next: ${dateToString(date)} (every ${revisionInterval} days)`;
        }
    }
    
    if (!currentRevision) {
        return `Completed ${totalRevisions}/${REVISION_SCHEDULE.length} Revisions`;
    }
    const targetDate = currentRevision.targetDate;
    const date = new Date(targetDate);

    if (currentRevision.isLongTerm) {
        if (targetDate === Infinity) return "L/T Review Pending Calc";
        if (targetDate <= TODAY_MS) return `L/T Review Due Today`;
        if (targetDate < TODAY_MS) return `Missed L/T: Due ${dateToString(date)}`;
    }

    if (targetDate < TODAY_MS) {
        return `Missed: Due ${dateToString(date)}`;
    } else if (targetDate === TODAY_MS) {
        return 'Due Today';
    } else {
        return `Next: ${dateToString(date)}`;
    }
};

// --- LIQUID THEME UI COMPONENTS ---

const Button = ({ children, onClick, className = '', disabled = false, variant = 'primary', type = 'button', iconOnly = false }) => {
    // Liquid / Apple Style Bases
    let baseStyle = `relative overflow-hidden transition-all duration-300 active:scale-95 focus:outline-none 
                     ${iconOnly ? 'p-3 rounded-full' : 'px-6 py-3 rounded-2xl'} font-medium shadow-lg backdrop-blur-md`;
    
    let colorStyle = '';

    switch (variant) {
        case 'primary':
            // Liquid Gradient Blue/Purple
            colorStyle = 'bg-gradient-to-br from-blue-500/90 to-purple-600/90 hover:from-blue-400 hover:to-purple-500 text-white border border-white/20 shadow-blue-500/30';
            break;
        case 'secondary':
            // Glassy White/Black
            colorStyle = 'bg-white/50 dark:bg-black/40 hover:bg-white/70 dark:hover:bg-black/60 text-gray-800 dark:text-gray-100 border border-white/30 dark:border-white/10';
            break;
        case 'success':
            colorStyle = 'bg-gradient-to-br from-green-400/90 to-emerald-600/90 hover:from-green-400 hover:to-emerald-500 text-white border border-white/20 shadow-emerald-500/30';
            break;
        case 'danger':
            colorStyle = 'bg-gradient-to-br from-red-400/90 to-rose-600/90 hover:from-red-400 hover:to-rose-500 text-white border border-white/20 shadow-red-500/30';
            break;
        case 'info':
            colorStyle = 'bg-gradient-to-br from-cyan-400/90 to-blue-600/90 hover:from-cyan-400 hover:to-blue-500 text-white border border-white/20';
            break;
        case 'outline':
            colorStyle = 'bg-transparent border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5';
            break;
        case 'ghost':
            baseStyle = `transition-all duration-300 active:scale-95 focus:outline-none ${iconOnly ? 'p-2 rounded-full' : 'px-4 py-2 rounded-xl'}`;
            colorStyle = 'bg-transparent text-gray-600 dark:text-gray-400 hover:bg-gray-200/50 dark:hover:bg-white/10 hover:text-gray-900 dark:hover:text-white';
            break;
        default:
             colorStyle = 'bg-white/20 hover:bg-white/30 text-white backdrop-blur-xl border border-white/20';
            break;
    }

    if (disabled) {
        colorStyle = 'bg-gray-200/50 dark:bg-gray-700/50 text-gray-400 cursor-not-allowed border border-gray-200/20 shadow-none';
    }

    return (
        <button
            onClick={!disabled ? onClick : undefined}
            className={`${baseStyle} ${colorStyle} ${className}`}
            disabled={disabled}
            type={type}
        >
            {children}
        </button>
    );
};

const Modal = ({ isOpen, onClose, title, children, size = 'sm:max-w-lg' }) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4" onClick={onClose}>
            {/* Liquid Backdrop */}
            <div className="absolute inset-0 bg-white/30 dark:bg-black/50 backdrop-blur-xl transition-all" />
            
            {/* Modal Content - Liquid Card */}
            <div className={`relative bg-white/80 dark:bg-gray-900/90 backdrop-blur-2xl border border-white/50 dark:border-white/10 rounded-3xl shadow-2xl w-full ${size} transform transition-all overflow-hidden flex flex-col max-h-[90vh]`} onClick={e => e.stopPropagation()}>
                <div className="px-8 py-5 border-b border-gray-200/30 dark:border-gray-700/30 flex justify-between items-center bg-gradient-to-r from-white/0 to-white/20 dark:to-white/5">
                    <h3 className="text-2xl font-bold text-gray-800 dark:text-white tracking-tight">{title}</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors bg-gray-100/50 dark:bg-gray-800/50 p-1 rounded-full" type="button">
                        <XCircle className="h-6 w-6" />
                    </button>
                </div>
                <div className="p-8 overflow-y-auto custom-scrollbar">
                    {children}
                </div>
            </div>
        </div>
    );
};

const ConfirmationModal = ({ isOpen, onClose, title, message, onConfirm, confirmText = 'Confirm' }) => {
    if (!isOpen) return null;

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={title}>
            <p className="text-gray-700 dark:text-gray-300 text-lg mb-8 leading-relaxed">{message}</p>
            <div className="flex justify-end space-x-3">
                <Button variant="secondary" onClick={onClose}>Cancel</Button>
                <Button variant="danger" onClick={() => { onConfirm(); onClose(); }}>{confirmText}</Button>
            </div>
        </Modal>
    );
};

// --- AuthScreen (Liquid Design) ---

const AuthScreen = ({ setUserId }) => {
    const [isLogin, setIsLogin] = useState(true);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            if (isLogin) {
                const userCredential = await exponentialBackoff(() => signInWithEmailAndPassword(auth, email, password));
                setUserId(userCredential.user.uid);
            } else {
                const userCredential = await exponentialBackoff(() => createUserWithEmailAndPassword(auth, email, password));
                setUserId(userCredential.user.uid);
            }
        } catch (err) {
            console.error(err);
            const friendlyError = err.code ? err.code.replace('auth/', '').replace(/-/g, ' ') : 'An unknown error occurred.';
            setError(`Error: ${friendlyError}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-100 via-purple-100 to-pink-100 dark:from-slate-900 dark:via-purple-950 dark:to-slate-900 p-4 transition-colors duration-500">
            {/* Animated Blobs */}
            <div className="absolute top-20 left-20 w-72 h-72 bg-purple-300 dark:bg-purple-600 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob"></div>
            <div className="absolute top-20 right-20 w-72 h-72 bg-yellow-300 dark:bg-blue-600 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob animation-delay-2000"></div>
            <div className="absolute -bottom-8 left-20 w-72 h-72 bg-pink-300 dark:bg-pink-600 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob animation-delay-4000"></div>

            <div className="relative bg-white/40 dark:bg-black/40 backdrop-blur-2xl p-10 rounded-[3rem] border border-white/50 dark:border-white/10 shadow-2xl w-full max-w-md">
                <h2 className="text-4xl font-extrabold text-gray-800 dark:text-white text-center mb-2">
                    {isLogin ? 'Welcome' : 'Join Us'}
                </h2>
                <p className="text-center text-gray-500 dark:text-gray-400 mb-8 font-medium">
                     {isLogin ? 'Sign in to continue your revision streak.' : 'Start your journey to better memory.'}
                </p>

                <form onSubmit={handleSubmit} className="space-y-5">
                    <div className="space-y-1">
                        <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase ml-3">Email</label>
                        <input
                            type="email"
                            placeholder="hello@example.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                            className="w-full p-4 bg-white/50 dark:bg-black/30 border border-white/30 dark:border-white/10 rounded-2xl text-gray-800 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all shadow-inner"
                            disabled={loading}
                        />
                    </div>
                    <div className="space-y-1">
                        <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase ml-3">Password</label>
                        <input
                            type="password"
                            placeholder="••••••••"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            className="w-full p-4 bg-white/50 dark:bg-black/30 border border-white/30 dark:border-white/10 rounded-2xl text-gray-800 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all shadow-inner"
                            disabled={loading}
                        />
                    </div>

                    {error && (
                        <div className="bg-red-100/50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-300 px-4 py-3 rounded-2xl text-sm text-center font-medium backdrop-blur-sm">
                            {error}
                        </div>
                    )}

                    <Button type="submit" variant="primary" className="w-full py-4 text-lg mt-4 shadow-xl" disabled={loading}>
                        {loading ? 'Processing...' : (isLogin ? 'Sign In' : 'Create Account')}
                    </Button>
                </form>

                <div className="mt-8 text-center">
                    <button
                        onClick={() => setIsLogin(!isLogin)}
                        className="text-sm font-semibold text-gray-600 dark:text-gray-300 hover:text-purple-600 dark:hover:text-purple-400 transition-colors"
                        disabled={loading}
                    >
                         {isLogin ? "New here? Create an account" : "Already have an account? Log in"}
                    </button>
                </div>
            </div>
        </div>
    );
};

// --- Collapsible Sidebar Component ---

const Sidebar = ({ activeSection, setActiveSection, setIsAddTopicModalOpen, setIsAddSubjectModalOpen, setIsRecycleBinOpen, deletedTopicsCount, userName, toggleDarkMode, darkMode, setIsProfileModalOpen, isCollapsed, toggleSidebar }) => {
    
    const NavItem = ({ section, icon: Icon, label, isActive }) => (
        <button
            onClick={() => setActiveSection(section)}
            className={`w-full flex items-center p-3 my-1 rounded-2xl transition-all duration-300 group
                ${isActive 
                    ? 'bg-gradient-to-r from-blue-500/20 to-purple-500/20 text-blue-700 dark:text-blue-300 font-bold shadow-sm border border-white/20' 
                    : 'text-gray-600 dark:text-gray-400 hover:bg-white/40 dark:hover:bg-white/10'
                }
            `}
            title={isCollapsed ? label : ''}
        >
            <div className={`flex items-center justify-center ${isCollapsed ? 'w-full' : ''}`}>
                <Icon className={`w-6 h-6 transition-colors ${isActive ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400 group-hover:text-gray-800 dark:group-hover:text-white'}`} />
            </div>
            {!isCollapsed && (
                <span className="ml-3 truncate">{label}</span>
            )}
        </button>
    );

    return (
        <div className={`fixed left-0 top-0 h-screen bg-white/60 dark:bg-black/60 backdrop-blur-2xl border-r border-white/40 dark:border-white/10 flex flex-col transition-all duration-300 z-50 shadow-2xl ${isCollapsed ? 'w-24' : 'w-72'}`}>
            {/* Header */}
            <div className="p-6 border-b border-gray-200/20 dark:border-gray-700/20 flex items-center justify-between">
                {!isCollapsed && (
                    <div className="animate-fade-in">
                        <h1 className="text-xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-purple-600 dark:from-blue-400 dark:to-purple-400">
                            Spaced<br/>Revision
                        </h1>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate">Hi, {userName}</p>
                    </div>
                )}
                <button 
                    onClick={toggleSidebar} 
                    className={`p-2 rounded-xl bg-white/50 dark:bg-white/10 hover:bg-white/80 dark:hover:bg-white/20 text-gray-600 dark:text-gray-300 transition-all ${isCollapsed ? 'mx-auto' : ''}`}
                >
                    {isCollapsed ? <ChevronRight className="w-5 h-5"/> : <ChevronLeft className="w-5 h-5"/>}
                </button>
            </div>

            {/* Nav */}
            <nav className="flex-1 p-4 space-y-2 overflow-y-auto custom-scrollbar">
                <NavItem section="revision" icon={Repeat} label="Revision" isActive={activeSection === 'revision'} />
                <NavItem section="tasks" icon={List} label="Tasks" isActive={activeSection === 'tasks'} />
                <NavItem section="periodic" icon={RotateCcw} label="Periodic" isActive={activeSection === 'periodic'} />
                <NavItem section="reports" icon={BarChart3} label="Reports" isActive={activeSection === 'reports'} />
                <NavItem section="random" icon={Dices} label="Random" isActive={activeSection === 'random'} />
                
                <div className="my-4 border-t border-gray-200/20 dark:border-gray-700/20"></div>

                {/* Actions */}
                <button 
                    onClick={() => setIsAddTopicModalOpen(true)}
                    className={`w-full flex items-center p-3 my-1 rounded-2xl bg-blue-500/10 hover:bg-blue-500/20 text-blue-700 dark:text-blue-300 transition-all ${isCollapsed ? 'justify-center' : ''}`}
                    title={isCollapsed ? "Add Item" : ""}
                >
                     <Plus className="w-6 h-6" />
                     {!isCollapsed && <span className="ml-3 font-semibold">Add Item</span>}
                </button>

                 <button 
                    onClick={() => setIsAddSubjectModalOpen(true)}
                    className={`w-full flex items-center p-3 my-1 rounded-2xl hover:bg-white/40 dark:hover:bg-white/10 text-gray-600 dark:text-gray-400 transition-all ${isCollapsed ? 'justify-center' : ''}`}
                    title={isCollapsed ? "Add Subject" : ""}
                >
                     <BookOpen className="w-6 h-6" />
                     {!isCollapsed && <span className="ml-3">Add Subject</span>}
                </button>

                <button 
                    onClick={() => setIsRecycleBinOpen(true)}
                    className={`w-full flex items-center p-3 my-1 rounded-2xl hover:bg-white/40 dark:hover:bg-white/10 text-gray-600 dark:text-gray-400 transition-all ${isCollapsed ? 'justify-center' : ''}`}
                    title={isCollapsed ? "Recycle Bin" : ""}
                >
                     <div className="relative">
                        <Trash2 className="w-6 h-6" />
                        {deletedTopicsCount > 0 && <span className="absolute -top-1 -right-1 bg-red-500 w-3 h-3 rounded-full border-2 border-white dark:border-black"></span>}
                     </div>
                     {!isCollapsed && <span className="ml-3">Bin ({deletedTopicsCount})</span>}
                </button>
            </nav>

            {/* Footer / Profile / Theme */}
            <div className="p-4 border-t border-gray-200/20 dark:border-gray-700/20 space-y-2 bg-gradient-to-t from-white/20 to-transparent dark:from-black/20">
                <button 
                    onClick={toggleDarkMode}
                    className={`w-full flex items-center p-3 rounded-2xl hover:bg-white/40 dark:hover:bg-white/10 text-gray-600 dark:text-gray-300 transition-all ${isCollapsed ? 'justify-center' : ''}`}
                    title={isCollapsed ? "Toggle Theme" : ""}
                >
                    {darkMode ? <Sun className="w-6 h-6 text-yellow-400" /> : <Moon className="w-6 h-6 text-indigo-500" />}
                    {!isCollapsed && <span className="ml-3 font-medium">{darkMode ? 'Light Mode' : 'Dark Mode'}</span>}
                </button>

                <button 
                    onClick={() => setIsProfileModalOpen(true)}
                    className={`w-full flex items-center p-3 rounded-2xl hover:bg-white/40 dark:hover:bg-white/10 text-gray-600 dark:text-gray-300 transition-all ${isCollapsed ? 'justify-center' : ''}`}
                    title={isCollapsed ? "Profile" : ""}
                >
                    <User className="w-6 h-6" />
                    {!isCollapsed && <span className="ml-3 font-medium">Profile</span>}
                </button>
            </div>
        </div>
    );
};

// --- Profile Components (Updated with Logout) ---

const ProfileModal = ({ userId, isOpen, onClose, userName, onSaveName }) => {
    const [name, setName] = useState(userName || '');
    const [isSavingName, setIsSavingName] = useState(false);
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [passwordError, setPasswordError] = useState('');
    const [passwordSuccess, setPasswordSuccess] = useState('');
    const [isChangingPassword, setIsChangingPassword] = useState(false);
    
    const currentUser = auth.currentUser;

    useEffect(() => {
        if (isOpen && userName) {
            setName(userName);
        }
    }, [isOpen, userName]);

    const handleSaveName = async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        setIsSavingName(true);
        try {
            await onSaveName(name.trim());
        } finally {
            setIsSavingName(false);
        }
    };

    const handleChangePassword = async (e) => {
        e.preventDefault();
        setPasswordError('');
        setPasswordSuccess('');
        
        if (password.length < 6) {
            setPasswordError('Password must be at least 6 characters long.');
            return;
        }
        if (password !== confirmPassword) {
            setPasswordError('Passwords do not match.');
            return;
        }

        setIsChangingPassword(true);
        try {
            await updatePassword(currentUser, password);
            setPasswordSuccess('Password successfully updated!');
            setPassword('');
            setConfirmPassword('');
        } catch (error) {
            console.error('Password change failed:', error);
            setPasswordError('Failed to change password. You may need to re-login.');
        } finally {
            setIsChangingPassword(false);
        }
    };

    const handleLogout = () => {
        signOut(auth);
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="User Profile & Settings" size="sm:max-w-xl">
            <div className="space-y-6">
                <div className="p-5 bg-blue-50/50 dark:bg-blue-900/20 rounded-2xl border border-blue-200 dark:border-blue-800 backdrop-blur-sm">
                    <h4 className="font-bold text-lg text-blue-800 dark:text-blue-200 flex items-center"><User className="w-5 h-5 mr-2" /> Account Details</h4>
                    <p className="text-sm text-gray-700 dark:text-gray-300 mt-2">Email: <span className="font-medium text-blue-600 dark:text-blue-300">{currentUser?.email || 'N/A'}</span></p>
                    <p className="text-sm text-gray-700 dark:text-gray-300">User ID: <code className="text-xs bg-white/50 dark:bg-black/20 px-2 py-0.5 rounded text-blue-600 dark:text-blue-300">{userId}</code></p>
                </div>

                <div className="space-y-4">
                    <h4 className="font-bold text-lg text-gray-800 dark:text-gray-200 flex items-center"><Edit className="w-5 h-5 mr-2" /> Change Display Name</h4>
                    <form onSubmit={handleSaveName} className="flex space-x-3">
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Your Display Name"
                            required
                            className="flex-grow p-3 border border-gray-300 dark:border-gray-600 rounded-2xl bg-white/50 dark:bg-gray-800/50 text-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                            disabled={isSavingName}
                        />
                        <Button type="submit" variant="primary" disabled={isSavingName || name === userName}>
                            {isSavingName ? 'Saving...' : 'Save'}
                        </Button>
                    </form>
                </div>

                <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                    <h4 className="font-bold text-lg text-gray-800 dark:text-gray-200 flex items-center mb-3"><Lock className="w-5 h-5 mr-2" /> Security</h4>
                    <form onSubmit={handleChangePassword} className="space-y-3">
                        <input
                            type="password"
                            placeholder="New Password (min 6 chars)"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-2xl bg-white/50 dark:bg-gray-800/50 text-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                            disabled={isChangingPassword}
                        />
                        <input
                            type="password"
                            placeholder="Confirm New Password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            required
                            className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-2xl bg-white/50 dark:bg-gray-800/50 text-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                            disabled={isChangingPassword}
                        />
                         {passwordError && (
                            <div className="bg-red-50 text-red-600 p-2 rounded-xl text-sm border border-red-100 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800">{passwordError}</div>
                        )}
                        {passwordSuccess && (
                            <div className="bg-green-50 text-green-600 p-2 rounded-xl text-sm border border-green-100 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800">{passwordSuccess}</div>
                        )}
                        <div className="flex justify-end">
                            <Button type="submit" variant="secondary" disabled={isChangingPassword || !password || !confirmPassword}>
                                {isChangingPassword ? 'Updating...' : 'Update Password'}
                            </Button>
                        </div>
                    </form>
                </div>

                <div className="pt-6 border-t border-gray-200 dark:border-gray-700">
                     <Button onClick={handleLogout} variant="danger" className="w-full flex items-center justify-center">
                        <LogOut className="w-5 h-5 mr-2"/> Logout
                     </Button>
                </div>
            </div>
        </Modal>
    );
};

// --- Timer Component ---

const TimerModal = ({ isOpen, onClose }) => {
    const [time, setTime] = useState(0);
    const [isRunning, setIsRunning] = useState(false);

    useEffect(() => {
        let interval = null;
        if (isRunning) {
            interval = setInterval(() => {
                setTime(prevTime => prevTime + 1000);
            }, 1000);
        } else if (!isRunning && time !== 0) {
            clearInterval(interval);
        }
        return () => clearInterval(interval);
    }, [isRunning, time]);

    const formatTime = (ms) => {
        const totalSeconds = Math.floor(ms / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        
        const pad = (num) => String(num).padStart(2, '0');
        
        return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
    };

    const handleReset = () => {
        setIsRunning(false);
        setTime(0);
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Focus Timer" size="sm:max-w-md">
            <div className="flex flex-col items-center space-y-8">
                <div className="relative">
                     {/* Glow effect */}
                    <div className="absolute inset-0 bg-blue-500 blur-3xl opacity-20 rounded-full"></div>
                    <div className="text-7xl font-mono font-bold text-gray-800 dark:text-white bg-white/50 dark:bg-black/30 backdrop-blur-md p-8 rounded-3xl shadow-inner border border-white/40 dark:border-white/10 relative z-10">
                        {formatTime(time)}
                    </div>
                </div>
                
                <div className="flex space-x-4">
                    <Button 
                        variant={isRunning ? 'danger' : 'success'} 
                        onClick={() => setIsRunning(!isRunning)}
                        className="py-4 px-8 text-xl shadow-xl"
                    >
                        {isRunning ? 'Pause' : 'Start'}
                    </Button>
                    <Button 
                        variant="secondary" 
                        onClick={handleReset} 
                        disabled={time === 0}
                        className="py-4 px-8 text-xl"
                    >
                        Reset
                    </Button>
                </div>
            </div>
        </Modal>
    );
};

// --- Floating Timer Button ---

const FloatingTimerButton = ({ onClick }) => {
    return (
        <button
            onClick={onClick}
            className="fixed bottom-6 right-6 w-16 h-16 bg-gradient-to-br from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white rounded-full shadow-2xl flex items-center justify-center transition-all hover:scale-110 active:scale-95 z-[80] group"
            title="Open Timer"
        >
             <div className="absolute inset-0 bg-white opacity-0 group-hover:opacity-20 rounded-full transition-opacity"></div>
            <Timer className="w-8 h-8" />
        </button>
    );
};

// --- Recycle Bin Modal ---

const RecycleBinModal = ({ deletedTopics, isOpen, onClose, onRecover, onEmptyBin }) => {
    const activeDeletedTopics = deletedTopics.filter(t => !t.isPermanentDelete);

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Recycle Bin" size="sm:max-w-2xl">
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                Items are permanently deleted 60 days after being moved here.
            </p>
            <div className="flex justify-between items-center mb-4 border-b border-gray-200 dark:border-gray-700 pb-3">
                <span className="font-semibold text-gray-700 dark:text-gray-300">Total Items: {activeDeletedTopics.length}</span>
                <Button 
                    variant="danger" 
                    onClick={() => onEmptyBin(activeDeletedTopics.map(t => t.id))}
                    disabled={activeDeletedTopics.length === 0}
                    className="text-xs py-1.5 px-3"
                >
                    Empty Bin Now
                </Button>
            </div>
            
            <div className="space-y-3 max-h-96 overflow-y-auto pr-2 custom-scrollbar">
                {activeDeletedTopics.length === 0 ? (
                    <div className="text-center p-12 bg-gray-50 dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10">
                        <Trash2 className="w-12 h-12 mx-auto text-gray-300 dark:text-gray-600 mb-3"/>
                        <p className="text-gray-500 dark:text-gray-400">Recycle Bin is empty.</p>
                    </div>
                ) : (
                    activeDeletedTopics.map(topic => (
                        <div key={topic.id} className="p-4 bg-white/60 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700 flex justify-between items-center shadow-sm backdrop-blur-sm">
                            <div>
                                <p className="font-semibold text-gray-800 dark:text-gray-200">{topic.name}</p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">Deleted: {dateToString(topic.deletedAt)}</p>
                            </div>
                            <Button variant="success" onClick={() => onRecover(topic.id)} className="text-xs py-1.5 px-3">
                                Restore
                            </Button>
                        </div>
                    ))
                )}
            </div>
        </Modal>
    );
};

// --- Manage Subjects Modal ---

const ManageSubjectsModal = ({ isOpen, onClose, subjects, onEdit, title }) => {
    if (!isOpen) return null;

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={title} size="sm:max-w-lg">
            <div className="space-y-3 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
                {subjects.length === 0 ? (
                    <p className="text-gray-500 dark:text-gray-400 text-center py-4">No subjects yet. Add one to get started.</p>
                ) : (
                    subjects.map(subject => (
                        <div key={subject.id} className="flex justify-between items-center p-3 bg-white/50 dark:bg-gray-800/50 rounded-xl border border-gray-200 dark:border-gray-700 backdrop-blur-sm">
                            <span className="font-medium text-gray-800 dark:text-gray-200">{subject.name}</span>
                            <Button 
                                variant="ghost"
                                iconOnly={true}
                                onClick={() => {
                                    onEdit(subject);
                                    onClose();
                                }} 
                            >
                                <Edit className="w-4 h-4" />
                            </Button>
                        </div>
                    ))
                )}
            </div>
            <div className="flex justify-end space-x-2 mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
                <Button variant="secondary" onClick={onClose}>Close</Button>
            </div>
        </Modal>
    );
};

// --- Edit Subject Modal ---

const EditSubjectModal = ({ isOpen, onClose, subject, userId }) => {
    const [name, setName] = useState('');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (isOpen && subject) {
            setName(subject.name);
        }
    }, [isOpen, subject]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!name.trim() || !subject || !userId) return;

        setLoading(true);
        try {
            const collectionGetter = subject.type === 'revision' ? getRevisionSubjectsCollection : getTaskSubjectsCollection;
            const subjectRef = doc(collectionGetter(userId), subject.id);
            await exponentialBackoff(() => updateDoc(subjectRef, { name: name.trim() }));
        } catch (error) {
            console.error('Error updating subject:', error);
        } finally {
            setLoading(false);
            onClose();
            setName('');
        }
    };

    if (!isOpen || !subject) return null;

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`Edit ${subject.type === 'revision' ? 'Revision' : 'Task'} Subject`}>
            <form onSubmit={handleSubmit}>
                <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Subject Name"
                    required
                    className="w-full p-4 border border-gray-300 dark:border-gray-600 rounded-2xl bg-white/50 dark:bg-gray-800/50 text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
                    disabled={loading}
                />
                <div className="flex justify-end space-x-2">
                    <Button variant="secondary" onClick={onClose} disabled={loading}>Cancel</Button>
                    <Button type="submit" variant="primary" disabled={loading || !name.trim()}>
                        {loading ? 'Saving...' : 'Save Changes'}
                    </Button>
                </div>
            </form>
        </Modal>
    );
};

// --- Forms and Logic (Add/Edit) ---

const SubtopicInputList = ({ subtopics, setSubtopics, disabled, isPeriodic = false }) => {
    const nextSubtopicId = useRef(0);

    useEffect(() => {
        const maxId = subtopics.reduce((max, sub) => Math.max(max, sub.id || 0), 0);
        nextSubtopicId.current = Math.max(maxId + 1, Date.now()); 
    }, [subtopics]);

    const addSubtopic = () => {
        const newId = nextSubtopicId.current++;
        setSubtopics([...subtopics, { id: newId, name: '', number: '', description: '' }]);
    };
    
    const updateSubtopic = (id, field, value) => {
        setSubtopics(subtopics.map(sub => 
            sub.id === id ? { ...sub, [field]: value } : sub
        ));
    };

    const removeSubtopic = (id) => {
        setSubtopics(subtopics.filter(sub => sub.id !== id));
    };

    return (
        <div className="space-y-3 p-4 bg-gray-50/50 dark:bg-white/5 rounded-2xl border border-gray-200 dark:border-gray-700 mt-4">
            <h4 className="text-base font-semibold text-gray-700 dark:text-gray-300">Subtopics / Problems (Optional)</h4>
            
            <div className="space-y-2 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
                {subtopics.map((sub) => (
                    <div key={sub.id} className="bg-white/70 dark:bg-black/30 p-2 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm backdrop-blur-sm">
                        <div className="flex items-center space-x-2 mb-2">
                            <input
                                type="text"
                                value={sub.name}
                                onChange={(e) => updateSubtopic(sub.id, 'name', e.target.value)}
                                placeholder="Subtopic Name / Problem Title"
                                className="flex-grow p-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-transparent text-gray-800 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                disabled={disabled}
                            />
                            {!isPeriodic && (
                                <input
                                    type="text"
                                    value={sub.number}
                                    onChange={(e) => updateSubtopic(sub.id, 'number', e.target.value)}
                                    placeholder="No."
                                    className="w-20 p-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-center bg-transparent text-gray-800 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    disabled={disabled}
                                />
                            )}
                            <button
                                type="button" 
                                onClick={(e) => { e.stopPropagation(); removeSubtopic(sub.id); }} 
                                className="text-red-400 hover:text-red-600 disabled:opacity-50 flex-shrink-0"
                                disabled={disabled}
                            >
                                <XCircle className="h-5 w-5" />
                            </button>
                        </div>
                        {isPeriodic && (
                            <textarea
                                value={sub.description}
                                onChange={(e) => updateSubtopic(sub.id, 'description', e.target.value)}
                                placeholder="Description / Notes"
                                className="w-full p-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-transparent text-gray-800 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                rows={2}
                                disabled={disabled}
                            />
                        )}
                    </div>
                ))}
            </div>

            <Button 
                type="button" 
                onClick={(e) => { e.stopPropagation(); addSubtopic(); }} 
                variant="secondary"
                className="w-full justify-center text-blue-600 bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/20 dark:hover:bg-blue-900/40 dark:text-blue-300 border-none"
                disabled={disabled}
            >
                <Plus className="h-4 w-4 mr-1" /> Add Problem/Subtopic
            </Button>
        </div>
    );
};

const AddTopicForm = ({ userId, subjects, isOpen, onClose, onAddTopic, defaultType = 'revision' }) => {
    const [type, setType] = useState(defaultType);
    const [topicName, setTopicName] = useState('');
    const [initialDate, setInitialDate] = useState(dateToISOString(TODAY_MS));
    const [taskDueDate, setTaskDueDate] = useState(dateToISOString(TODAY_MS));
    const [taskSchedule, setTaskSchedule] = useState('specific');
    const [selectedSubjectId, setSelectedSubjectId] = useState('');
    const [subtopics, setSubtopics] = useState([]); 
    const [enableLtr, setEnableLtr] = useState(false);
    const [revisionInterval, setRevisionInterval] = useState(30);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (subjects.length > 0 && !selectedSubjectId) {
            setSelectedSubjectId(subjects[0].id);
        }
    }, [subjects, selectedSubjectId]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!topicName.trim() || !selectedSubjectId || !userId) return;

        setLoading(true);
        const studyDate = new Date(initialDate);
        studyDate.setHours(0, 0, 0, 0);

        const cleanedSubtopics = subtopics
            .filter(sub => sub.name.trim() !== '')
            .map(sub => ({ name: sub.name.trim(), number: sub.number?.trim() || '', description: sub.description?.trim() || '' }));
        
        let finalTaskDueDate = null;
        if (type === 'task') {
            if (taskSchedule === 'specific') {
                finalTaskDueDate = taskDueDate ? new Date(taskDueDate).getTime() : null;
            } else if (taskSchedule === 'tomorrow') {
                finalTaskDueDate = TOMORROW_MS;
            } else if (taskSchedule === 'today') {
                finalTaskDueDate = TODAY_MS;
            } else if (taskSchedule === 'recommended') {
                finalTaskDueDate = null;
            }
        }

        let periodicData = {};
        if (type === 'periodic') {
            const lastRevisedMs = studyDate.getTime();
            periodicData = {
                lastRevised: lastRevisedMs,
                nextRevision: lastRevisedMs + (1 * 24 * 60 * 60 * 1000), // Next day pending
                revisionInterval,
                revisionHistory: [],
            };
        }

        try {
            await onAddTopic({
                type,
                name: topicName.trim(),
                subjectId: selectedSubjectId,
                initialStudyDate: type === 'revision' ? studyDate.getTime() : null,
                taskDueDate: finalTaskDueDate,
                subtopics: cleanedSubtopics,
                enableLtr: type === 'revision' ? enableLtr : false,
                ...periodicData,
            });
            
            setTopicName('');
            setInitialDate(dateToISOString(TODAY_MS));
            setSubtopics([]);
            setEnableLtr(false);
            onClose();
        } catch (error) {
            console.error('Error adding topic/task:', error);
        } finally {
            setLoading(false);
        }
    };

    const isRevision = type === 'revision';
    const isTask = type === 'task';
    const isPeriodic = type === 'periodic';
    const hasSubjects = subjects.length > 0;

    const inputClasses = "w-full p-4 border border-gray-300 dark:border-gray-600 rounded-2xl bg-white/50 dark:bg-gray-800/50 text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all";

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Add New Study Item">
            <form onSubmit={handleSubmit}>
                <div className="flex space-x-2 mb-6 justify-center bg-gray-100 dark:bg-gray-800 p-1 rounded-2xl">
                    <button
                        type="button" 
                        onClick={() => setType('revision')} 
                        className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-all ${isRevision ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-300 shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'}`}
                    >
                        Revision
                    </button>
                    <button 
                        type="button" 
                        onClick={() => setType('task')} 
                        className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-all ${isTask ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-300 shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'}`}
                    >
                        Task
                    </button>
                    <button 
                        type="button" 
                        onClick={() => setType('periodic')} 
                        className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-all ${isPeriodic ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-300 shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'}`}
                    >
                        Periodic
                    </button>
                </div>

                <input
                    type="text"
                    value={topicName}
                    onChange={(e) => setTopicName(e.target.value)}
                    placeholder={isPeriodic ? "Main Topic Name (e.g., Recursion)" : isRevision ? "Topic Name" : "Task Name (e.g., Read Chapter 3)"}
                    required
                    className={`${inputClasses} mb-4`}
                    disabled={loading}
                />
                
                <div className="flex flex-col sm:flex-row sm:space-x-4 space-y-4 sm:space-y-0 mb-4">
                    <select
                        value={selectedSubjectId}
                        onChange={(e) => setSelectedSubjectId(e.target.value)}
                        required
                        className={`${inputClasses} flex-1`}
                        disabled={loading || !hasSubjects}
                    >
                        {!hasSubjects && <option value="" className="text-black">No Subjects Added</option>}
                        {subjects.map(subject => (
                            <option key={subject.id} value={subject.id} className="text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-800">{subject.name}</option>
                        ))}
                    </select>
                    
                    {isRevision ? (
                        <input
                            type="date"
                            value={initialDate}
                            onChange={(e) => setInitialDate(e.target.value)}
                            required
                            title="Original Study Date"
                            className={`${inputClasses} sm:w-1/2`}
                            disabled={loading}
                        />
                    ) : isTask ? (
                        <div className="w-full sm:w-1/2 space-y-2">
                             <select
                                value={taskSchedule}
                                onChange={(e) => { setTaskSchedule(e.target.value); if (e.target.value !== 'specific') setTaskDueDate(dateToISOString(TODAY_MS)); }}
                                className={inputClasses}
                                disabled={loading}
                            >
                                <option value="today" className="text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-800">Schedule Today</option>
                                <option value="tomorrow" className="text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-800">Schedule Tomorrow</option>
                                <option value="specific" className="text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-800">Schedule Specific Date</option>
                                <option value="recommended" className="text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-800">Recommended List</option>
                            </select>
                            {taskSchedule === 'specific' && (
                                <input
                                    type="date"
                                    value={taskDueDate}
                                    onChange={(e) => setTaskDueDate(e.target.value)}
                                    required
                                    className={inputClasses}
                                    disabled={loading}
                                />
                            )}
                        </div>
                    ) : isPeriodic ? (
                        <div className="w-full sm:w-1/2 space-y-2">
                            <input
                                type="date"
                                value={initialDate}
                                onChange={(e) => setInitialDate(e.target.value)}
                                required
                                className={inputClasses}
                                disabled={loading}
                            />
                            <select
                                value={revisionInterval}
                                onChange={(e) => setRevisionInterval(Number(e.target.value))}
                                className={inputClasses}
                                disabled={loading}
                            >
                                <option value={15} className="text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-800">Every 15 Days</option>
                                <option value={20} className="text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-800">Every 20 Days</option>
                                <option value={30} className="text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-800">Every 30 Days</option>
                                <option value={45} className="text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-800">Every 45 Days</option>
                                <option value={60} className="text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-800">Every 60 Days</option>
                            </select>
                        </div>
                    ) : null}
                </div>

                <SubtopicInputList subtopics={subtopics} setSubtopics={setSubtopics} disabled={loading} isPeriodic={isPeriodic} />

                {isRevision && (
                    <div className="mt-4 flex items-center space-x-3 bg-purple-50 dark:bg-purple-900/30 p-4 rounded-2xl border border-purple-100 dark:border-purple-800/50">
                        <input 
                            type="checkbox" 
                            id="enableLtr" 
                            checked={enableLtr} 
                            onChange={(e) => setEnableLtr(e.target.checked)}
                            className="w-5 h-5 text-purple-600 rounded border-gray-300 focus:ring-purple-500"
                        />
                        <label htmlFor="enableLtr" className="text-sm font-medium text-purple-800 dark:text-purple-200 cursor-pointer">
                            Enable Long-Term Review (45 Days after final revision)
                        </label>
                    </div>
                )}

                <div className="flex justify-end space-x-3 mt-6">
                    <Button variant="secondary" onClick={onClose} disabled={loading}>Cancel</Button>
                    <Button type="submit" variant="primary" disabled={loading || !topicName.trim() || !selectedSubjectId}>
                        {loading ? 'Saving...' : `Save Item`}
                    </Button>
                </div>
            </form>
        </Modal>
    );
};

const EditTopicModal = ({ userId, topic, subjects, isOpen, onClose, onSave }) => {
    const initialStudyDateString = topic ? dateToISOString(topic.initialStudyDate || topic.lastRevised || TODAY_MS) : dateToISOString(TODAY_MS);
    
    const [topicName, setTopicName] = useState('');
    const [initialDate, setInitialDate] = useState(initialStudyDateString);
    const [taskDueDate, setTaskDueDate] = useState('');
    const [selectedSubjectId, setSelectedSubjectId] = useState('');
    const [subtopics, setSubtopics] = useState([]); 
    const [enableLtr, setEnableLtr] = useState(false);
    const [revisionInterval, setRevisionInterval] = useState(30);
    const [loading, setLoading] = useState(false);
    
    useEffect(() => {
        if (topic && isOpen) {
            setTopicName(topic.name || '');
            setSelectedSubjectId(topic.subjectId || '');
            setInitialDate(dateToISOString(topic.initialStudyDate || topic.lastRevised || TODAY_MS));
            setTaskDueDate(topic.taskDueDate ? dateToISOString(topic.taskDueDate) : '');
            setEnableLtr(topic.enableLtr || false);
            setRevisionInterval(topic.revisionInterval || 30);
            setSubtopics(topic.subtopics?.map((sub, index) => ({...sub, id: sub.id || Date.now() + index})) || []);
        }
    }, [topic, isOpen]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!topicName.trim() || !selectedSubjectId || !userId || !topic) return;

        setLoading(true);
        
        const cleanedSubtopics = subtopics
            .filter(sub => sub.name.trim() !== '')
            .map(sub => ({ name: sub.name.trim(), number: sub.number?.trim() || '', description: sub.description?.trim() || '' }));
        
        try {
            await onSave(topic.id, topicName.trim(), selectedSubjectId, initialDate, cleanedSubtopics, enableLtr, taskDueDate, revisionInterval);
            onClose();
        } catch (error) {
            console.error('Error saving edited topic:', error);
        } finally {
            setLoading(false);
        }
    };

    const isRevision = topic?.type === 'revision';
    const isTask = topic?.type === 'task';
    const isPeriodic = topic?.type === 'periodic';

    const inputClasses = "w-full p-4 border border-gray-300 dark:border-gray-600 rounded-2xl bg-white/50 dark:bg-gray-800/50 text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all";

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`Edit Item`}>
            <form onSubmit={handleSubmit}>
                <input
                    type="text"
                    value={topicName}
                    onChange={(e) => setTopicName(e.target.value)}
                    placeholder="Topic Name"
                    required
                    className={`${inputClasses} mb-4`}
                    disabled={loading}
                />
                <div className="flex flex-col sm:flex-row sm:space-x-4 space-y-4 sm:space-y-0 mb-4">
                    <select
                        value={selectedSubjectId}
                        onChange={(e) => setSelectedSubjectId(e.target.value)}
                        required
                        className={`${inputClasses} flex-1`}
                        disabled={loading || subjects.length === 0}
                    >
                        {subjects.length === 0 && <option value="" className="text-black">No Subjects Added</option>}
                        {subjects.map(subject => (
                            <option key={subject.id} value={subject.id} className="text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-800">{subject.name}</option>
                        ))}
                    </select>
                    
                    {isRevision ? (
                        <input
                            type="date"
                            value={initialDate}
                            onChange={(e) => setInitialDate(e.target.value)}
                            required
                            className={`${inputClasses} sm:w-1/2`}
                            disabled={loading}
                        />
                    ) : isTask ? (
                         <input
                            type="date"
                            value={taskDueDate}
                            onChange={(e) => setTaskDueDate(e.target.value)}
                            className={`${inputClasses} sm:w-1/2`}
                            disabled={loading}
                        />
                    ) : isPeriodic ? (
                        <div className="w-full sm:w-1/2 space-y-2">
                            <input
                                type="date"
                                value={initialDate}
                                onChange={(e) => setInitialDate(e.target.value)}
                                required
                                className={inputClasses}
                                disabled={loading}
                            />
                            <select
                                value={revisionInterval}
                                onChange={(e) => setRevisionInterval(Number(e.target.value))}
                                className={inputClasses}
                                disabled={loading}
                            >
                                <option value={15} className="text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-800">Every 15 Days</option>
                                <option value={20} className="text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-800">Every 20 Days</option>
                                <option value={30} className="text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-800">Every 30 Days</option>
                                <option value={45} className="text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-800">Every 45 Days</option>
                                <option value={60} className="text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-800">Every 60 Days</option>
                            </select>
                        </div>
                    ) : null}
                </div>
                
                <SubtopicInputList subtopics={subtopics} setSubtopics={setSubtopics} disabled={loading} isPeriodic={isPeriodic} />

                {isRevision && (
                    <div className="mt-4 flex items-center space-x-3 bg-purple-50 dark:bg-purple-900/30 p-4 rounded-2xl border border-purple-100 dark:border-purple-800/50">
                        <input 
                            type="checkbox" 
                            id="enableLtr-edit" 
                            checked={enableLtr} 
                            onChange={(e) => setEnableLtr(e.target.checked)}
                            className="w-5 h-5 text-purple-600 rounded focus:ring-purple-500"
                        />
                        <label htmlFor="enableLtr-edit" className="text-sm font-medium text-purple-800 dark:text-purple-200 cursor-pointer">
                            Enable Long-Term Review
                        </label>
                    </div>
                )}

                <div className="flex justify-end space-x-2 mt-6">
                    <Button variant="secondary" onClick={onClose} disabled={loading}>Cancel</Button>
                    <Button type="submit" variant="primary" disabled={loading || !topicName.trim() || !selectedSubjectId}>
                        {loading ? 'Saving...' : 'Save Changes'}
                    </Button>
                </div>
            </form>
        </Modal>
    );
};

// --- Calendar View Component (Fixed for White Screen & Counts) ---

const CalendarView = ({ topics, allSubjects, isTaskView = false, isPeriodicView = false }) => {
    const [currentDate, setCurrentDate] = useState(today());
    const [selectedDate, setSelectedDate] = useState(null);
    const [modalOpen, setModalOpen] = useState(false);

    useEffect(() => {
        if (selectedDate !== null) {
            setModalOpen(true);
        } else {
            setModalOpen(false);
        }
    }, [selectedDate]);

    const startOfMonth = useMemo(() => {
        const d = new Date(currentDate);
        d.setDate(1);
        return d;
    }, [currentDate]);

    const daysInMonth = useMemo(() => {
        const d = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
        return d.getDate();
    }, [currentDate]);

    const firstDayOfWeek = startOfMonth.getDay();

    const itemMap = useMemo(() => {
        const map = new Map();
        if (isTaskView) {
            topics.forEach(topic => {
                if (topic.type === 'task' && topic.taskDueDate && !topic.isComplete) {
                    const dateKey = dateToISOString(new Date(topic.taskDueDate));
                    if (!map.has(dateKey)) {
                        map.set(dateKey, []);
                    }
                    map.get(dateKey).push({
                        type: 'Task',
                        topicName: topic.name,
                        subjectName: (allSubjects[topic.subjectId] || {}).name || 'Unknown',
                        isMissed: topic.taskDueDate < TODAY_MS,
                    });
                }
            });
        } else if (isPeriodicView) {
            topics.forEach(topic => {
                if (topic.type === 'periodic' && topic.nextRevision) {
                    const dateKey = dateToISOString(new Date(topic.nextRevision));
                    if (!map.has(dateKey)) {
                        map.set(dateKey, []);
                    }
                    map.get(dateKey).push({
                        type: 'Periodic Review',
                        topicName: topic.name,
                        subjectName: (allSubjects[topic.subjectId] || {}).name || 'Unknown',
                        isMissed: topic.nextRevision < TODAY_MS,
                    });
                }
            });
        } else {
            topics.forEach(topic => {
                topic.schedule?.forEach((scheduleItem) => {
                    if (!scheduleItem.completed && scheduleItem.targetDate !== Infinity) {
                        const dateKey = dateToISOString(new Date(scheduleItem.targetDate));
                        if (!map.has(dateKey)) {
                            map.set(dateKey, []);
                        }
                        map.get(dateKey).push({
                            type: 'Revision',
                            topicName: topic.name,
                            subjectName: (allSubjects[topic.subjectId] || {}).name || 'Unknown',
                            isMissed: scheduleItem.targetDate < TODAY_MS,
                        });
                    }
                });

                if (topic.type === 'task' && topic.taskDueDate && !topic.isComplete) {
                    const dateKey = dateToISOString(new Date(topic.taskDueDate));
                    if (!map.has(dateKey)) {
                        map.set(dateKey, []);
                    }
                    map.get(dateKey).push({
                        type: 'Task',
                        topicName: topic.name,
                        subjectName: (allSubjects[topic.subjectId] || {}).name || 'Unknown',
                        isMissed: topic.taskDueDate < TODAY_MS,
                    });
                }
            });
        }
        return map;
    }, [topics, allSubjects, isTaskView, isPeriodicView]);

    const handlePrevMonth = () => {
        const newDate = new Date(currentDate);
        newDate.setMonth(newDate.getMonth() - 1);
        setCurrentDate(newDate);
        setSelectedDate(null);
    };

    const handleNextMonth = () => {
        const newDate = new Date(currentDate);
        newDate.setMonth(newDate.getMonth() + 1);
        setCurrentDate(newDate);
        setSelectedDate(null);
    };

    const handleToday = () => {
        setCurrentDate(today());
        setSelectedDate(today());
    };

    const handleDayClick = (dayOfMonth) => {
        const date = new Date(currentDate.getFullYear(), currentDate.getMonth(), dayOfMonth);
        setSelectedDate(date);
    };

    const todayISO = dateToISOString(today());
    const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    return (
        <div className="p-6 bg-white/70 dark:bg-black/30 backdrop-blur-2xl border border-white/40 dark:border-white/10 rounded-3xl shadow-lg">
            <header className="flex justify-between items-center mb-6">
                <Button onClick={handlePrevMonth} variant="ghost" iconOnly={true}>
                    <ChevronLeft className="w-5 h-5"/>
                </Button>
                <div className="text-xl font-bold flex flex-col items-center text-gray-800 dark:text-white">
                    {currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                    <button onClick={handleToday} className="mt-1 text-xs text-blue-500 hover:underline">Jump to Today</button>
                </div>
                <Button onClick={handleNextMonth} variant="ghost" iconOnly={true}>
                    <ChevronRight className="w-5 h-5"/>
                </Button>
            </header>

            <div className="grid grid-cols-7 gap-1 text-center font-bold text-xs text-gray-400 dark:text-gray-500 mb-2 uppercase tracking-wide">
                {daysOfWeek.map(day => (
                    <div key={day} className="py-2">{day}</div>
                ))}
            </div>

            <div className="grid grid-cols-7 gap-2">
                {[...Array(firstDayOfWeek)].map((_, i) => (
                    <div key={`empty-${i}`} className="h-16"></div>
                ))}

                {[...Array(daysInMonth)].map((_, i) => {
                    const day = i + 1;
                    const date = new Date(currentDate.getFullYear(), currentDate.getMonth(), day);
                    const dateISO = dateToISOString(date);
                    const itemsDue = itemMap.get(dateISO);
                    const isToday = dateISO === todayISO;
                    const isSelected = selectedDate && dateISO === dateToISOString(selectedDate);
                    const hasItems = itemsDue && itemsDue.length > 0;
                    const itemCount = hasItems ? itemsDue.length : 0;
                    
                    const cellClasses = `relative h-16 flex flex-col items-center justify-center rounded-2xl transition-all cursor-pointer border
                                         ${isToday ? 'bg-blue-600 text-white shadow-lg border-transparent' : 'bg-white/40 dark:bg-white/5 hover:bg-white/80 dark:hover:bg-white/10 text-gray-700 dark:text-gray-300 border-white/20 dark:border-white/5'}
                                         ${isSelected && !isToday ? 'ring-2 ring-purple-500 bg-purple-100 dark:bg-purple-900/30' : ''}`;

                    return (
                        <div key={day} className={cellClasses} onClick={() => handleDayClick(day)}>
                            <span className="font-semibold text-sm">{day}</span>
                            {hasItems && (
                                <div className={`absolute top-1 right-1 h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-bold border border-white dark:border-gray-900
                                    ${itemsDue.some(r => r.isMissed) ? 'bg-red-500 text-white' : isToday ? 'bg-white text-blue-600' : 'bg-green-500 text-white'}`}>
                                    {itemCount}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            <Modal 
                isOpen={modalOpen} 
                onClose={() => setSelectedDate(null)} 
                title={`${isTaskView ? 'Tasks' : isPeriodicView ? 'Reviews' : 'Schedule'} for ${dateToString(selectedDate)}`}
                size="sm:max-w-xl"
            >
                {selectedDate && itemMap.has(dateToISOString(selectedDate)) ? (
                    <div className="space-y-3 max-h-96 overflow-y-auto pr-2 custom-scrollbar">
                        {itemMap.get(dateToISOString(selectedDate)).map((item, index) => (
                            <div 
                                key={index} 
                                className={`p-4 rounded-2xl shadow-sm border-l-4 backdrop-blur-sm
                                    ${item.isMissed ? 'bg-red-50 dark:bg-red-900/20 border-red-500' : item.type === 'Task' ? 'bg-purple-50 dark:bg-purple-900/20 border-purple-500' : 'bg-green-50 dark:bg-green-900/20 border-green-500'}`}
                            >
                                <p className="font-semibold text-gray-800 dark:text-white">{item.topicName}</p>
                                <div className="flex justify-between text-sm text-gray-600 dark:text-gray-300 mt-1">
                                    <span>{item.subjectName}</span>
                                    <span className="font-bold opacity-80">
                                        {item.isMissed ? 'MISSED' : item.type === 'Task' ? 'TASK DUE' : 'REVISION'}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="text-center py-8">
                        <p className="text-gray-500 dark:text-gray-400">Nothing scheduled. Enjoy your free time!</p>
                    </div>
                )}
            </Modal>
        </div>
    );
};

// --- App Logic Component ---

const AppLogic = ({ userId, topics, subjects, allSubjects, deletedTopics }) => {
    const [activeSection, setActiveSection] = useState('revision');
    const [activeRevisionTab, setActiveRevisionTab] = useState('dashboard');
    const [activeTaskTab, setActiveTaskTab] = useState('today');
    const [activePeriodicTab, setActivePeriodicTab] = useState('dashboard');
    const [darkMode, setDarkMode] = useState(false);
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

    const [isAddTopicModalOpen, setIsAddTopicModalOpen] = useState(false);
    const [isAddSubjectModalOpen, setIsAddSubjectModalOpen] = useState(false);
    const [isRecycleBinOpen, setIsRecycleBinOpen] = useState(false);
    const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);

    const [topicToEdit, setTopicToEdit] = useState(null); 
    const [isEditTopicModalOpen, setIsEditTopicModalOpen] = useState(false); 
    const [isTimerModalOpen, setIsTimerModalOpen] = useState(false);

    const [isManageRevisionSubjectsOpen, setIsManageRevisionSubjectsOpen] = useState(false);
    const [isManageTaskSubjectsOpen, setIsManageTaskSubjectsOpen] = useState(false);
    const [editingSubject, setEditingSubject] = useState(null);
    const [isEditSubjectModalOpen, setIsEditSubjectModalOpen] = useState(false);

    const [confirmAction, setConfirmAction] = useState({
        isOpen: false,
        title: '',
        message: '',
        onConfirm: () => {},
        confirmText: 'Confirm'
    });

    const [selectedSubjectFilter, setSelectedSubjectFilter] = useState('all');
    const [sortOption, setSortOption] = useState('newest'); // 'newest', 'oldest', 'alpha', 'lastRevised'
    const [userName, setUserName] = useState('');

    // Theme initialization
    useEffect(() => {
        const savedTheme = localStorage.getItem('theme');
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        const initialDark = savedTheme === 'dark' || (savedTheme === null && prefersDark);
        setDarkMode(initialDark);
        if (initialDark) {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }
    }, []);

    const toggleDarkMode = () => {
        const newDark = !darkMode;
        setDarkMode(newDark);
        if (newDark) {
            document.documentElement.classList.add('dark');
            localStorage.setItem('theme', 'dark');
        } else {
            document.documentElement.classList.remove('dark');
            localStorage.setItem('theme', 'light');
        }
    };

    const toggleSidebar = () => {
        setIsSidebarCollapsed(!isSidebarCollapsed);
    }

    useEffect(() => {
        if (userId) {
            const userDocRef = getUserDocRef(userId);
            const unsubscribe = onSnapshot(userDocRef, (docSnap) => {
                if (docSnap.exists() && docSnap.data().name) {
                    setUserName(docSnap.data().name);
                } else {
                    setUserName(auth.currentUser?.email.split('@')[0] || 'User');
                }
            }, (error) => {
                console.error("Error fetching user profile:", error);
                setUserName(auth.currentUser?.email.split('@')[0] || 'User');
            });
            return () => unsubscribe();
        }
    }, [userId]);

    const handleSaveName = useCallback(async (name) => {
        if (!userId) return;
        const userDocRef = getUserDocRef(userId);
        try {
            await exponentialBackoff(() => setDoc(userDocRef, { name: name }, { merge: true }));
            setUserName(name);
        } catch (error) {
            console.error("Error saving user name:", error);
        }
    }, [userId]);

    const handleEditSubject = useCallback((subject) => {
        setEditingSubject(subject);
        setIsEditSubjectModalOpen(true);
    }, []);

    const AddSubjectForm = ({ userId, onClose, subjectCollectionGetter }) => {
        const [name, setName] = useState('');
        const [loading, setLoading] = useState(false);
    
        const handleSubmit = async (e) => {
            e.preventDefault();
            if (!name.trim() || !userId) return;
    
            setLoading(true);
            try {
                const subjectDocRef = doc(subjectCollectionGetter(userId));
                await exponentialBackoff(() => setDoc(subjectDocRef, {
                    name: name.trim(),
                    createdAt: Date.now(),
                    id: subjectDocRef.id
                }));
                setName('');
                onClose();
            } catch (error) {
                console.error('Error adding subject:', error);
            } finally {
                setLoading(false);
            }
        };
    
        return (
            <form onSubmit={handleSubmit}>
                <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Subject Name (e.g., Data Structures, Math)"
                    required
                    className="w-full p-4 border border-gray-300 dark:border-gray-600 rounded-2xl bg-white/50 dark:bg-gray-800/50 text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
                    disabled={loading}
                />
                <div className="flex justify-end space-x-2">
                    <Button variant="secondary" onClick={onClose} disabled={loading}>Cancel</Button>
                    <Button type="submit" variant="primary" disabled={loading || !name.trim()}>
                        {loading ? 'Adding...' : 'Add Subject'}
                    </Button>
                </div>
            </form>
        );
    };

    const handleAddTopic = useCallback(async (newTopicData) => {
        if (!userId) return;

        try {
            const topicDocRef = doc(getTopicsCollection(userId));
            const topicData = {
                ...newTopicData,
                id: topicDocRef.id,
                schedule: newTopicData.type === 'revision' ? generateSchedule(new Date(newTopicData.initialStudyDate), newTopicData.enableLtr) : [],
                deleted: false,
                deletedAt: null,
                createdAt: Date.now(),
                isComplete: false,
            };

            await exponentialBackoff(() => setDoc(topicDocRef, topicData));
            setIsAddTopicModalOpen(false);
        } catch (error) {
            console.error('Error adding topic/task:', error);
        }
    }, [userId]);

    const handleMarkDone = useCallback(async (topic) => {
        if (!userId || !topic || !topic.id) { 
            console.error("Attempted to mark done with invalid topic or ID.");
            return;
        }
        
        const topicRef = doc(getTopicsCollection(userId), topic.id);

        try {
            await exponentialBackoff(async () => {
                const batch = writeBatch(db);

                if (topic.type === 'task') {
                    batch.update(topicRef, { isComplete: true, completedDate: Date.now() });
                } else if (topic.type === 'periodic') {
                    const nowMs = Date.now();
                    const newNext = nowMs + (topic.revisionInterval * 24 * 60 * 60 * 1000);
                    const updatedHistory = [...(topic.revisionHistory || []), nowMs];
                    batch.update(topicRef, { 
                        lastRevised: nowMs, 
                        nextRevision: newNext, 
                        revisionHistory: updatedHistory 
                    });
                } else {
                    const currentRevision = topic.nextRevision;

                    if (!currentRevision) {
                        console.error("Attempted to mark done without a next revision.");
                        return;
                    }

                    let updatedSchedule = topic.schedule.map(s => {
                        if (s.targetDate === currentRevision.targetDate) {
                            return { ...s, completed: true, completedDate: Date.now() };
                        }
                        return s;
                    });
                    
                    const allRevisionsCompleted = updatedSchedule.filter(s => !s.isLongTerm).every(s => s.completed);

                    if (allRevisionsCompleted && topic.enableLtr) {
                        const ltrIndex = updatedSchedule.findIndex(s => s.isLongTerm);
                        const lastCompletedDate = Date.now();
                        const nextReviewDate = new Date(lastCompletedDate);
                        nextReviewDate.setDate(nextReviewDate.getDate() + LONG_TERM_REVIEW_INTERVAL);

                        if (ltrIndex !== -1) {
                            updatedSchedule[ltrIndex] = {
                                ...updatedSchedule[ltrIndex],
                                targetDate: nextReviewDate.getTime(),
                                completed: false,
                            };
                        } else {
                            updatedSchedule.push({
                                targetDate: nextReviewDate.getTime(),
                                completed: false,
                                interval: LONG_TERM_REVIEW_INTERVAL,
                                isLongTerm: true,
                            });
                        }
                    }

                    batch.update(topicRef, { schedule: updatedSchedule });
                }
                
                await batch.commit();
            });

        } catch (error) {
            console.error('Error marking revision done:', error);
        }
    }, [userId]);
    
    const handleShift = useCallback(async (topicId, missedTargetDate) => {
        if (!userId || !topicId) return; 
        const topicRef = doc(getTopicsCollection(userId), topicId);

        try {
            await exponentialBackoff(async () => {
                const batch = writeBatch(db);
                const topic = topics.find(t => t.id === topicId);
                if (!topic) return;

                const updatedSchedule = topic.schedule.map(s => {
                    if (!s.completed && s.targetDate >= missedTargetDate) {
                        return { ...s, targetDate: s.targetDate + (1000 * 60 * 60 * 24) };
                    }
                    return s;
                });

                batch.update(topicRef, { schedule: updatedSchedule });
                await batch.commit();
            });
        } catch (error) {
            console.error('Error shifting date:', error);
        }
    }, [userId, topics]);

    const handleSoftDelete = useCallback(async (topicId) => {
        if (!userId || !topicId) return; 
        const topicRef = doc(getTopicsCollection(userId), topicId);
        try {
            await exponentialBackoff(() => updateDoc(topicRef, { 
                deleted: true, 
                deletedAt: Date.now() 
            }));
        } catch (error) {
            console.error('Error soft deleting topic:', error);
        }
    }, [userId]);

    const handlePermanentDelete = useCallback(async (topicIds) => {
        if (!userId || topicIds.length === 0) return;
        try {
            await exponentialBackoff(async () => {
                const batch = writeBatch(db);
                topicIds.forEach(topicId => {
                    batch.delete(doc(getTopicsCollection(userId), topicId));
                });
                await batch.commit();
            });
        } catch (error) {
            console.error('Error permanently deleting topic(s):', error);
        }
    }, [userId]);

    const handleRecover = useCallback(async (topicId) => {
        if (!userId || !topicId) return;
        const topicRef = doc(getTopicsCollection(userId), topicId);
        try {
            await exponentialBackoff(() => updateDoc(topicRef, { 
                deleted: false, 
                deletedAt: null 
            }));
        } catch (error) {
            console.error('Error recovering topic:', error);
        }
    }, [userId]);

    const handleEditTopic = useCallback(async (topicId, name, subjectId, initialDateString, subtopics, enableLtr, taskDueDateString, revisionInterval) => {
        if (!userId || !topicId) return; 
        
        const topicRef = doc(getTopicsCollection(userId), topicId);
        const existingTopic = topics.find(t => t.id === topicId);
        
        const newStudyDate = new Date(initialDateString);
        newStudyDate.setHours(0, 0, 0, 0);
        const newStudyDateMs = newStudyDate.getTime();
        
        let updateData = {
            name: name,
            subjectId: subjectId,
            subtopics: subtopics,
        };
        
        if (existingTopic.type === 'revision') {
            const originalStudyDateMs = existingTopic.initialStudyDate;
            updateData.enableLtr = enableLtr;

            const dateChanged = newStudyDateMs !== originalStudyDateMs;
            const ltrChanged = existingTopic.enableLtr !== enableLtr;

            if (dateChanged || ltrChanged) {
                updateData.initialStudyDate = newStudyDateMs;
                updateData.schedule = generateSchedule(newStudyDate, enableLtr);
            }
        } else if (existingTopic.type === 'task') {
            updateData.taskDueDate = taskDueDateString ? new Date(taskDueDateString).getTime() : null;
        } else if (existingTopic.type === 'periodic') {
            const originalLastRevised = existingTopic.lastRevised;
            const intervalChanged = existingTopic.revisionInterval !== revisionInterval;

            updateData.revisionInterval = revisionInterval;

            if (newStudyDateMs !== originalLastRevised || intervalChanged) {
                updateData.lastRevised = newStudyDateMs;
                updateData.nextRevision = newStudyDateMs + (revisionInterval * 24 * 60 * 60 * 1000);
            }
        }

        try {
            await exponentialBackoff(() => updateDoc(topicRef, updateData));
        } catch (error) {
            console.error('Error updating topic:', error);
            throw error; 
        }
    }, [userId, topics]);

    const processedTopics = useMemo(() => {
        return topics.filter(t => !t.deleted).map(topic => {
            const type = topic.type || 'revision'; 
            
            let completedCount = 0;
            let nextRevision = null;
            let revisionInterval = topic.revisionInterval || 30;

            if (type === 'revision') {
                completedCount = topic.schedule?.filter(s => s.completed && !s.isLongTerm)?.length || 0;
                nextRevision = topic.schedule?.find(s => !s.completed) || null;
                
                if (topic.enableLtr && completedCount === REVISION_SCHEDULE.length) {
                    const ltrRevision = topic.schedule.find(s => s.isLongTerm);

                    if (ltrRevision) {
                        let nextLtrDateMs = ltrRevision.targetDate;

                        if (nextLtrDateMs === Infinity) {
                            const lastCompletedItem = [...topic.schedule]
                                .filter(s => s.completed)
                                .sort((a, b) => b.completedDate - a.completedDate)[0];

                            const lastCompletedDateMs = lastCompletedItem?.completedDate || topic.initialStudyDate;
                            
                            const reviewDate = new Date(lastCompletedDateMs);
                            reviewDate.setDate(reviewDate.getDate() + LONG_TERM_REVIEW_INTERVAL);
                            reviewDate.setHours(0, 0, 0, 0);
                            
                            nextRevision = { ...ltrRevision, targetDate: reviewDate.getTime() };
                        } else {
                            nextRevision = ltrRevision;
                        }
                    }
                }
            } else if (type === 'periodic') {
                completedCount = topic.revisionHistory?.length || 0;
                nextRevision = topic.nextRevision ? { targetDate: topic.nextRevision } : null;
            }
            
            const isComplete = (type === 'task' && topic.isComplete) || (type === 'revision' && !nextRevision); 
            
            let isPending = false;
            let isMissed = false;
            let isTaskPending = false; 

            if ((type === 'revision' || type === 'periodic') && nextRevision) {
                isPending = nextRevision.targetDate <= TODAY_MS;
                isMissed = nextRevision.targetDate < TODAY_MS;
            } else if (type === 'task' && topic.taskDueDate && !topic.isComplete) {
                isTaskPending = topic.taskDueDate <= TOMORROW_MS;
                isPending = isTaskPending;
                isMissed = topic.taskDueDate < TODAY_MS;
            }
            
            const isDone = completedCount > 0;

            return {
                ...topic,
                type,
                completedCount,
                nextRevision,
                isComplete,
                isPending,
                isMissed,
                isDone,
                isTaskPending,
                subjectName: (allSubjects[topic.subjectId] || {}).name || 'Unknown Subject',
            };
        });
    }, [topics, allSubjects]);
    
    const getRevisionTopics = useMemo(() => processedTopics.filter(t => t.type === 'revision'), [processedTopics]);
    const getTaskTopics = useMemo(() => processedTopics.filter(t => t.type === 'task'), [processedTopics]);
    const getPeriodicTopics = useMemo(() => processedTopics.filter(t => t.type === 'periodic'), [processedTopics]);

    const revisionTabCounts = useMemo(() => ({
        pending: getRevisionTopics.filter(t => t.isPending && !t.isMissed).length,
        missed: getRevisionTopics.filter(t => t.isMissed).length,
        done: getRevisionTopics.filter(t => t.isDone && !t.isComplete).length,
    }), [getRevisionTopics]);

    const taskTabCounts = useMemo(() => {
        const allTasks = getTaskTopics;
        const activeTasks = allTasks.filter(t => !t.isComplete);
        const completedTasks = allTasks.filter(t => t.isComplete);

        return {
            today: activeTasks.filter(t => t.taskDueDate && t.taskDueDate <= TODAY_MS).length,
            tomorrow: activeTasks.filter(t => t.taskDueDate && t.taskDueDate === TOMORROW_MS).length,
            upcoming: activeTasks.filter(t => t.taskDueDate && t.taskDueDate > TOMORROW_MS).length,
            recommended: activeTasks.filter(t => !t.taskDueDate).length,
            totalActive: activeTasks.length,
            totalCompleted: completedTasks.length,
            total: allTasks.length,
        }
    }, [getTaskTopics]);

    const periodicTabCounts = useMemo(() => ({
        pending: getPeriodicTopics.filter(t => t.isPending && !t.isMissed).length,
        missed: getPeriodicTopics.filter(t => t.isMissed).length,
        done: getPeriodicTopics.filter(t => t.isDone).length,
    }), [getPeriodicTopics]);
    
    const handleMarkDoneClick = useCallback((topic) => {
        setConfirmAction({
            isOpen: true,
            title: 'Confirm Completion',
            message: `Are you sure you want to mark "${topic.name}" as DONE?`,
            onConfirm: () => handleMarkDone(topic),
            confirmText: 'Mark Done'
        });
    }, [handleMarkDone]);

    const handleDeleteClick = useCallback((topicId) => {
        setConfirmAction({
            isOpen: true,
            title: 'Confirm Deletion',
            message: 'Are you sure you want to delete this item? It will be moved to the Recycle Bin.',
            onConfirm: () => handleSoftDelete(topicId),
            confirmText: 'Move to Bin'
        });
    }, [handleSoftDelete]);
    
    const handleOpenEditModal = useCallback((topic) => {
        setTopicToEdit(topic);
        setIsEditTopicModalOpen(true);
    }, []);

    const tabClasses = (tab, currentActive) => (
        `flex-1 text-center py-2 font-semibold transition-all rounded-xl text-xs sm:text-sm mx-1
        ${currentActive === tab ? 'bg-white text-blue-600 shadow-md transform scale-105' : 'text-gray-500 hover:bg-white/50 hover:text-gray-700'}`
    );

    const TopicCard = ({ topic, subjectName, onMarkDone, onShift, onDelete, onEdit }) => {
        const totalRevisions = REVISION_SCHEDULE.length;
        const completedRevisions = topic.type === 'revision' ? topic.schedule?.filter(s => s.completed && !s.isLongTerm)?.length || 0 : topic.completedCount;
        const currentRevision = topic.nextRevision;
        
        const isComplete = topic.isComplete;
        
        const statusText = getStatusText(currentRevision, completedRevisions, topic.type, topic.nextRevision ? topic.nextRevision.targetDate : null, topic.revisionInterval);
        const isMissed = statusText.startsWith('Missed') || topic.isMissed;
        const isDue = statusText.includes('Due Today');
        
        const nextDate = topic.type === 'task' 
            ? (topic.taskDueDate ? new Date(topic.taskDueDate) : null)
            : (currentRevision ? new Date(currentRevision.targetDate) : null);
        
        const initialStudyDate = topic.type === 'revision' ? dateToString(topic.initialStudyDate) : topic.type === 'periodic' ? dateToString(topic.lastRevised) : dateToString(topic.createdAt);
        
        const progressPercent = topic.type === 'revision' ? (completedRevisions / totalRevisions) * 100 : 0;
        const hasSubtopics = topic.subtopics && topic.subtopics.length > 0;

        let cardBorder = 'border-transparent';
        let statusColor = 'text-gray-500 dark:text-gray-400';
        let typeBadge = '';
        
        if (topic.type === 'revision') {
            typeBadge = 'Revision Topic';
            if (isComplete) {
                cardBorder = 'border-l-4 border-l-green-400';
                statusColor = 'text-green-500';
            } else if (isDue) {
                cardBorder = 'border-l-4 border-l-blue-400 shadow-blue-500/10';
                statusColor = 'text-blue-500';
            } else if (isMissed) {
                cardBorder = 'border-l-4 border-l-red-400 shadow-red-500/10';
                statusColor = 'text-red-500';
            } else if (nextDate && nextDate.getTime() < (TODAY_MS + (3 * 24 * 60 * 60 * 1000))) {
                cardBorder = 'border-l-4 border-l-yellow-400';
                statusColor = 'text-yellow-600 dark:text-yellow-400';
            }
        } else if (topic.type === 'task') {
            typeBadge = 'Study Task';
            if (topic.isComplete) {
                cardBorder = 'border-l-4 border-l-green-400';
                statusColor = 'text-green-500';
            } else if (isMissed) {
                cardBorder = 'border-l-4 border-l-red-400';
                statusColor = 'text-red-500';
            } else if (topic.isTaskPending) {
                cardBorder = 'border-l-4 border-l-orange-400';
                statusColor = 'text-orange-500';
            } else {
                cardBorder = 'border-l-4 border-l-purple-400';
            }
        } else if (topic.type === 'periodic') {
            typeBadge = 'Periodic Review';
            if (isDue) {
                cardBorder = 'border-l-4 border-l-blue-400';
                statusColor = 'text-blue-500';
            } else if (isMissed) {
                cardBorder = 'border-l-4 border-l-red-400';
                statusColor = 'text-red-500';
            } else if (nextDate && nextDate.getTime() < (TODAY_MS + (7 * 24 * 60 * 60 * 1000))) {
                cardBorder = 'border-l-4 border-l-yellow-400';
                statusColor = 'text-yellow-600';
            } else {
                cardBorder = 'border-l-4 border-l-indigo-400';
            }
        }

        return (
            <div className={`relative bg-white/70 dark:bg-gray-800/60 backdrop-blur-xl border border-white/40 dark:border-white/5 rounded-3xl shadow-lg hover:shadow-xl transition-all p-6 flex flex-col space-y-4 group overflow-hidden ${cardBorder}`}>
                <div className="absolute top-0 right-0 p-4 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => onDelete(topic.id)} className="text-gray-400 hover:text-red-500 transition-colors">
                        <Trash2 className="w-5 h-5"/>
                    </button>
                </div>

                <div className="flex justify-between items-start pr-8">
                    <div>
                        <h4 className="text-xl font-bold text-gray-800 dark:text-white tracking-tight">{topic.name}</h4>
                        <div className="flex flex-wrap gap-2 mt-2">
                            <span className="text-xs font-bold text-purple-600 dark:text-purple-300 bg-purple-100 dark:bg-purple-900/40 px-3 py-1 rounded-full uppercase tracking-wider">
                                {subjectName}
                            </span>
                            <span className="text-xs font-bold text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-white/10 px-3 py-1 rounded-full uppercase tracking-wider">
                                {typeBadge}
                            </span>
                        </div>
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-2 font-medium">
                            {topic.type === 'revision' ? 'First Studied:' : topic.type === 'periodic' ? 'Last Revised:' : 'Created/Due:'} <span className="text-gray-600 dark:text-gray-300">{initialStudyDate}</span>
                        </p>
                    </div>
                </div>

                <div className={`text-sm font-bold flex items-center ${statusColor}`}>
                     {topic.type === 'task' && topic.isComplete ? <CheckCircle className="w-4 h-4 mr-2"/> : isMissed ? <XCircle className="w-4 h-4 mr-2"/> : <Clock className="w-4 h-4 mr-2"/>}
                    {topic.type === 'task' && topic.isComplete ? 'Completed' : statusText}
                </div>
                 
                 {/* Progress Details */}
                 <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 font-medium">
                     {topic.type === 'revision' && !topic.isComplete && (
                        <span>Revision {completedRevisions} / {totalRevisions}</span>
                    )}
                    {topic.type === 'task' && nextDate && !topic.isComplete && (
                        <span>Due: {dateToString(nextDate)}</span>
                    )}
                 </div>


                {hasSubtopics && (
                    <div className="bg-white/50 dark:bg-black/20 p-4 rounded-2xl border border-gray-100 dark:border-white/5 max-h-40 overflow-y-auto custom-scrollbar">
                        <h5 className="text-xs font-bold text-gray-500 dark:text-gray-400 mb-2 uppercase tracking-wider">Subtopics ({topic.subtopics.length})</h5>
                        <ul className="space-y-2">
                            {topic.subtopics.map((sub, index) => (
                                <li key={index} className="text-sm text-gray-700 dark:text-gray-200">
                                    <div className="flex justify-between items-center">
                                        <span className="font-medium truncate flex-1">{sub.name}</span>
                                        {sub.number && (
                                            <span className="text-xs font-mono bg-gray-200 dark:bg-white/10 px-2 py-0.5 rounded-md text-gray-600 dark:text-gray-300 ml-2">
                                                {sub.number}
                                            </span>
                                        )}
                                    </div>
                                    {sub.description && (
                                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 whitespace-pre-line break-words pl-2 border-l-2 border-gray-200 dark:border-gray-700">{sub.description}</p>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
                
                 {topic.type === 'revision' && (
                    <div className="pt-2">
                        <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                            <div
                                className={`h-full bg-gradient-to-r from-green-400 to-emerald-500 transition-all duration-700 ease-out`}
                                style={{ width: `${progressPercent}%` }}
                            ></div>
                        </div>
                    </div>
                 )}

                <div className="flex items-center space-x-2 pt-2">
                    {!isComplete && (
                        <Button 
                            variant="success" 
                            onClick={() => onMarkDone(topic)} 
                            className="flex-1 py-2 text-sm"
                        >
                            {topic.type === 'periodic' ? 'Reviewed' : 'Done'}
                        </Button>
                    )}
                    {topic.type === 'revision' && isMissed && (
                        <Button variant="danger" onClick={() => onShift(topic.id, currentRevision.targetDate)} className="flex-1 py-2 text-sm">
                            Shift +1D
                        </Button>
                    )}
                    <Button variant="secondary" onClick={() => onEdit(topic)} className="flex-1 py-2 text-sm">
                        Edit
                    </Button>
                </div>
            </div>
        );
    };

    const RevisionSection = ({handleMarkDoneClick, handleShift, handleDeleteClick, handleOpenEditModal}) => {
        const revisionTopics = getRevisionTopics;
        let list = [...revisionTopics];

        const currentSubjects = subjects.filter(s => s.type === 'revision');

        // Apply sorting
        list.sort((a, b) => {
            if (sortOption === 'newest') return b.createdAt - a.createdAt;
            if (sortOption === 'oldest') return a.createdAt - b.createdAt;
            if (sortOption === 'alpha') return a.name.localeCompare(b.name);
            if (sortOption === 'lastRevised') {
                const dateA = a.lastRevised || a.createdAt;
                const dateB = b.lastRevised || b.createdAt;
                return dateB - dateA;
            }
            return 0;
        });

        if (selectedSubjectFilter !== 'all') {
            list = list.filter(t => t.subjectId === selectedSubjectFilter);
        }

        let content = null;
        switch (activeRevisionTab) {
            case 'pending':
                list = list.filter(t => t.isPending && !t.isMissed);
                break;
            case 'missed':
                list = list.filter(t => t.isMissed);
                break;
            case 'done':
                list = list.filter(t => t.isDone && !t.isComplete);
                break;
            case 'calendar':
                content = <CalendarView topics={revisionTopics} allSubjects={allSubjects} />;
                break;
            case 'dashboard':
            default:
                break;
        }

        if (!content) {
            content = (
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {list.length > 0 ? (
                        list.map(topic => (
                            <TopicCard
                                key={topic.id}
                                topic={topic}
                                subjectName={topic.subjectName}
                                onMarkDone={handleMarkDoneClick}
                                onShift={handleShift}
                                onDelete={handleDeleteClick}
                                onEdit={handleOpenEditModal}
                            />
                        ))
                    ) : (
                        <div className="col-span-full py-16 text-center">
                             <div className="bg-white/40 dark:bg-white/5 backdrop-blur-xl p-8 rounded-3xl inline-block shadow-lg">
                                <h3 className="text-2xl font-semibold mb-2 text-gray-600 dark:text-gray-300">All Clear!</h3>
                                <p className="text-gray-500 dark:text-gray-400">No revision topics match this filter.</p>
                                <Button variant="primary" onClick={() => setIsAddTopicModalOpen(true)} className="mt-4">
                                    Add New Topic
                                </Button>
                             </div>
                        </div>
                    )}
                </div>
            );
        }

        return (
            <>
                {/* Filters and Sorting Bar */}
                <div className="bg-white/60 dark:bg-black/40 backdrop-blur-xl p-2 rounded-2xl shadow-sm mb-8 border border-white/50 dark:border-white/10 flex flex-col md:flex-row md:items-center space-y-2 md:space-y-0 md:space-x-4 overflow-x-auto custom-scrollbar">
                    
                    <div className="flex items-center space-x-2 px-2">
                        <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Filters:</span>
                        <div className="flex space-x-2">
                            <button
                                onClick={() => setSelectedSubjectFilter('all')}
                                className={`px-4 py-1.5 rounded-xl text-sm font-medium transition-all whitespace-nowrap
                                    ${selectedSubjectFilter === 'all' ? 'bg-white shadow text-blue-600' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}`}
                            >
                                All Subjects
                            </button>
                            {currentSubjects.map(subject => (
                                <button
                                    key={subject.id}
                                    onClick={() => setSelectedSubjectFilter(subject.id)}
                                    className={`px-4 py-1.5 rounded-xl text-sm font-medium transition-all whitespace-nowrap
                                        ${selectedSubjectFilter === subject.id ? 'bg-white shadow text-blue-600' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}`}
                                >
                                    {subject.name}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="h-6 w-px bg-gray-300 dark:bg-gray-700 hidden md:block"></div>

                    <div className="flex items-center space-x-2 px-2">
                         <span className="text-xs font-bold text-gray-400 uppercase tracking-wider"><ArrowUpDown className="w-3 h-3 inline"/> Sort:</span>
                         <select 
                            value={sortOption} 
                            onChange={(e) => setSortOption(e.target.value)}
                            className="bg-transparent text-sm font-medium text-gray-600 dark:text-gray-300 focus:outline-none cursor-pointer"
                        >
                            <option value="newest">Newest Added</option>
                            <option value="oldest">Oldest Added</option>
                            <option value="alpha">Name (A-Z)</option>
                            <option value="lastRevised">Last Revised</option>
                        </select>
                    </div>

                    <div className="flex-grow"></div>
                     <Button 
                        variant="ghost" 
                        onClick={() => setIsManageRevisionSubjectsOpen(true)} 
                        className="text-xs whitespace-nowrap"
                    >
                        <Edit className="w-3 h-3 mr-1" /> Manage
                    </Button>
                </div>

                <div className="flex bg-gray-100/80 dark:bg-gray-800/80 p-1.5 rounded-2xl mb-8 sticky top-0 z-10 backdrop-blur-md shadow-sm border border-gray-200 dark:border-gray-700">
                    <button onClick={() => setActiveRevisionTab('dashboard')} className={tabClasses('dashboard', activeRevisionTab)}>
                         Dashboard
                    </button>
                    <button onClick={() => setActiveRevisionTab('pending')} className={tabClasses('pending', activeRevisionTab)}>
                         Pending ({revisionTabCounts.pending})
                    </button>
                    <button onClick={() => setActiveRevisionTab('missed')} className={tabClasses('missed', activeRevisionTab)}>
                         Missed ({revisionTabCounts.missed})
                    </button>
                    <button onClick={() => setActiveRevisionTab('done')} className={tabClasses('done', activeRevisionTab)}>
                         Done ({revisionTabCounts.done})
                    </button>
                    <button onClick={() => setActiveRevisionTab('calendar')} className={tabClasses('calendar', activeRevisionTab)}>
                         Calendar
                    </button>
                </div>
                
                {content}
            </>
        );
    };
    
    const TaskSection = ({handleMarkDoneClick, handleDeleteClick, handleOpenEditModal}) => {
        const allTasks = getTaskTopics;
        const activeTasks = allTasks.filter(t => !t.isComplete);
        const completedTasks = allTasks.filter(t => t.isComplete);
        const currentSubjects = subjects.filter(s => s.type === 'task');

        let list = activeTasks;
        
        if (selectedSubjectFilter !== 'all') {
            list = list.filter(t => t.subjectId === selectedSubjectFilter);
        }

        const filteredList = useMemo(() => {
            switch (activeTaskTab) {
                case 'today':
                    return list.filter(t => t.taskDueDate && t.taskDueDate <= TODAY_MS)
                               .sort((a, b) => (a.taskDueDate || Infinity) - (b.taskDueDate || Infinity));
                case 'tomorrow':
                    return list.filter(t => t.taskDueDate && t.taskDueDate === TOMORROW_MS);
                case 'upcoming':
                    return list.filter(t => t.taskDueDate && t.taskDueDate > TOMORROW_MS);
                case 'recommended':
                    return list.filter(t => !t.taskDueDate);
                case 'completed':
                    return completedTasks.filter(t => selectedSubjectFilter === 'all' || t.subjectId === selectedSubjectFilter);
                case 'calendar':
                    return null;
                default:
                    return list;
            }
        }, [list, activeTaskTab, completedTasks, selectedSubjectFilter]);
        
        const CompletedTasksView = useMemo(() => {
            const tasksToGroup = filteredList.filter(t => t.isComplete);

            const groupedTasks = new Map();
            tasksToGroup.forEach(task => {
                const dateMs = task.completedDate || task.taskDueDate || TODAY_MS;
                const dateKey = dateToISOString(dateMs);
                
                if (!groupedTasks.has(dateKey)) {
                    groupedTasks.set(dateKey, { date: dateToString(dateMs), tasks: [] });
                }
                groupedTasks.get(dateKey).tasks.push(task);
            });

            return Array.from(groupedTasks.values()).sort((a, b) => new Date(b.date) - new Date(a.date));
        }, [filteredList]);

        const todayPending = activeTasks.filter(t => t.taskDueDate && t.taskDueDate === TODAY_MS).length;
        const todayCompletedCount = completedTasks.filter(t => t.taskDueDate && t.taskDueDate === TODAY_MS).length;
        const todayTotal = todayPending + todayCompletedCount;
        const todayDone = todayCompletedCount;
        const todayLeft = todayPending;
        const todayCompletionRate = todayTotal > 0 ? (todayDone / todayTotal) * 100 : 0;

        const weeklyPending = activeTasks.filter(t => t.taskDueDate && t.taskDueDate >= START_OF_WEEK_MS && t.taskDueDate <= END_OF_WEEK_MS).length;
        const weeklyCompletedCount = completedTasks.filter(t => t.taskDueDate && t.taskDueDate >= START_OF_WEEK_MS && t.taskDueDate <= END_OF_WEEK_MS).length;
        const weeklyTotal = weeklyPending + weeklyCompletedCount;
        const weeklyDone = weeklyCompletedCount;
        const weeklyLeft = weeklyPending;
        const weeklyCompletionRate = weeklyTotal > 0 ? (weeklyDone / weeklyTotal) * 100 : 0;

        const CircularProgress = ({ percentage, size = 80 }) => {
            const radius = (size - 8) / 2;
            const circumference = 2 * Math.PI * radius;
            const offset = circumference * (1 - percentage / 100);
            
            return (
                <svg width={size} height={size} className="transform -rotate-90" viewBox={`0 0 ${size} ${size}`}>
                    <circle
                        cx={size / 2}
                        cy={size / 2}
                        r={radius}
                        stroke="currentColor"
                        strokeWidth="8"
                        fill="none"
                        strokeDasharray={circumference}
                        strokeDashoffset={circumference}
                        className="text-gray-200 dark:text-gray-700"
                    />
                    <circle
                        cx={size / 2}
                        cy={size / 2}
                        r={radius}
                        stroke="currentColor"
                        strokeWidth="8"
                        fill="none"
                        strokeDasharray={circumference}
                        strokeDashoffset={offset}
                        strokeLinecap="round"
                        className="transition-all duration-1000 ease-out text-blue-500 drop-shadow-lg"
                    />
                    <text
                        x={size / 2}
                        y={size / 2}
                        textAnchor="middle"
                        dy=".3em"
                        className="text-xl font-bold fill-current text-gray-700 dark:text-white"
                    >
                        {Math.round(percentage)}%
                    </text>
                </svg>
            );
        };

        let content = null;
        if (activeTaskTab === 'completed') {
            content = (
                <div className="space-y-6">
                    {CompletedTasksView.length > 0 ? (
                        CompletedTasksView.map(group => (
                            <div key={group.date} className="bg-white/60 dark:bg-gray-800/60 backdrop-blur-xl p-5 rounded-3xl shadow-sm border border-white/50 dark:border-white/10">
                                <h4 className="text-xl font-bold text-green-600 dark:text-green-400 mb-4 border-b border-gray-200 dark:border-gray-700 pb-2">Completed: {group.date}</h4>
                                <div className="space-y-3">
                                    {group.tasks.map(task => (
                                        <div key={task.id} className="p-4 bg-green-50/50 dark:bg-green-900/10 rounded-2xl flex justify-between items-center border border-green-100 dark:border-green-900/30">
                                            <p className="font-medium text-gray-700 dark:text-gray-200">{task.name}</p>
                                            <span className="text-sm text-gray-500 dark:text-gray-400 bg-white/50 dark:bg-black/20 px-3 py-1 rounded-full">
                                                {task.subjectName}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))
                    ) : (
                         <div className="col-span-2 py-12 text-center text-gray-500 dark:text-gray-400">
                            <h3 className="text-2xl font-semibold mb-2">No Completed Tasks</h3>
                            <p>Mark some tasks done to see your progress here!</p>
                        </div>
                    )}
                </div>
            );
        } else if (activeTaskTab === 'calendar') {
            content = <CalendarView topics={getTaskTopics} allSubjects={allSubjects} isTaskView={true} />;
        } else {
            const SectionTitle = ({ fallbackText }) => {
                if (activeTaskTab === 'recommended') {
                    return <h3 className="text-xl font-bold text-gray-700 dark:text-white mb-6">{fallbackText}</h3>
                }
                if (activeTaskTab === 'today') {
                    return <h3 className="text-xl font-bold text-gray-700 dark:text-white mb-6">Today's Tasks & Overdue</h3>;
                }
                if (activeTaskTab === 'tomorrow') {
                    return <h3 className="text-xl font-bold text-gray-700 dark:text-white mb-6">Tomorrow's Tasks</h3>;
                }
                return <h3 className="text-xl font-bold text-gray-700 dark:text-white mb-6">{fallbackText}</h3>;
            };

            content = (
                <>
                    <SectionTitle 
                        fallbackText={activeTaskTab === 'upcoming' ? "Upcoming Tasks (After Tomorrow)" : "Recommended Tasks (No Date)"}
                    />
                    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {filteredList.length > 0 ? (
                            filteredList.map(topic => (
                                <TopicCard
                                    key={topic.id}
                                    topic={topic}
                                    subjectName={topic.subjectName}
                                    onMarkDone={handleMarkDoneClick}
                                    onShift={() => {}}
                                    onDelete={handleDeleteClick}
                                    onEdit={handleOpenEditModal}
                                />
                            ))
                        ) : (
                            <div className="col-span-full py-12 text-center text-gray-500 dark:text-gray-400">
                                <h3 className="text-2xl font-semibold mb-2">No Tasks Found</h3>
                                <p>You are all caught up for this section!</p>
                            </div>
                        )}
                    </div>
                </>
            );
        }

        return (
            <>
                 {/* Stats Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                        <div className="p-6 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-3xl border border-blue-100 dark:border-blue-800/30 flex items-center justify-between shadow-sm">
                            <div>
                                <p className="text-sm font-bold text-blue-600 dark:text-blue-300 uppercase tracking-wide">Today's Focus</p>
                                <h4 className="text-4xl font-extrabold text-gray-800 dark:text-white mt-2">{todayTotal}</h4>
                                <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 font-medium">Done: {todayDone} | Left: {todayLeft}</p>
                            </div>
                            <CircularProgress percentage={todayCompletionRate} size={80} />
                        </div>
                         <div className="p-6 bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 rounded-3xl border border-purple-100 dark:border-purple-800/30 flex items-center justify-between shadow-sm">
                            <div>
                                <p className="text-sm font-bold text-purple-600 dark:text-purple-300 uppercase tracking-wide">Weekly Goal</p>
                                <h4 className="text-4xl font-extrabold text-gray-800 dark:text-white mt-2">{weeklyTotal}</h4>
                                <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 font-medium">Done: {weeklyDone} | Left: {weeklyLeft}</p>
                            </div>
                            <CircularProgress percentage={weeklyCompletionRate} size={80} />
                        </div>
                </div>

                 <div className="bg-white/60 dark:bg-black/40 backdrop-blur-xl p-2 rounded-2xl shadow-sm mb-8 border border-white/50 dark:border-white/10 flex items-center space-x-2 overflow-x-auto custom-scrollbar">
                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider ml-2 mr-2">Filters:</span>
                    <button
                        onClick={() => setSelectedSubjectFilter('all')}
                        className={`px-4 py-1.5 rounded-xl text-sm font-medium transition-all whitespace-nowrap
                            ${selectedSubjectFilter === 'all' ? 'bg-white shadow text-blue-600' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}`}
                    >
                        All Subjects
                    </button>
                    {currentSubjects.map(subject => (
                        <button
                            key={subject.id}
                            onClick={() => setSelectedSubjectFilter(subject.id)}
                            className={`px-4 py-1.5 rounded-xl text-sm font-medium transition-all whitespace-nowrap
                                ${selectedSubjectFilter === subject.id ? 'bg-white shadow text-blue-600' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}`}
                        >
                            {subject.name}
                        </button>
                    ))}
                     <div className="flex-grow"></div>
                     <Button 
                        variant="ghost" 
                        onClick={() => setIsManageTaskSubjectsOpen(true)} 
                        className="text-xs whitespace-nowrap"
                    >
                        <Edit className="w-3 h-3 mr-1" /> Manage
                    </Button>
                </div>

                <div className="flex bg-gray-100/80 dark:bg-gray-800/80 p-1.5 rounded-2xl mb-8 sticky top-0 z-10 backdrop-blur-md shadow-sm border border-gray-200 dark:border-gray-700 overflow-x-auto">
                    <button onClick={() => setActiveTaskTab('today')} className={tabClasses('today', activeTaskTab)}>
                        Today ({taskTabCounts.today})
                    </button>
                    <button onClick={() => setActiveTaskTab('tomorrow')} className={tabClasses('tomorrow', activeTaskTab)}>
                        Tomorrow ({taskTabCounts.tomorrow})
                    </button>
                    <button onClick={() => setActiveTaskTab('upcoming')} className={tabClasses('upcoming', activeTaskTab)}>
                        Upcoming ({taskTabCounts.upcoming})
                    </button>
                    <button onClick={() => setActiveTaskTab('recommended')} className={tabClasses('recommended', activeTaskTab)}>
                        Recommended
                    </button>
                     <button onClick={() => setActiveTaskTab('completed')} className={tabClasses('completed', activeTaskTab)}>
                        Completed
                    </button>
                    <button onClick={() => setActiveTaskTab('calendar')} className={tabClasses('calendar', activeTaskTab)}>
                        Calendar
                    </button>
                </div>
                
                {content}
            </>
        );
    };

    const PeriodicSection = ({handleMarkDoneClick, handleDeleteClick, handleOpenEditModal}) => {
        const periodicTopics = getPeriodicTopics;
        let list = periodicTopics;

        const currentSubjects = subjects.filter(s => s.type === 'revision'); // Sharing with revision

        if (selectedSubjectFilter !== 'all') {
            list = list.filter(t => t.subjectId === selectedSubjectFilter);
        }

        let content = null;
        switch (activePeriodicTab) {
            case 'pending':
                list = list.filter(t => t.isPending && !t.isMissed);
                break;
            case 'missed':
                list = list.filter(t => t.isMissed);
                break;
            case 'done':
                list = list.filter(t => t.isDone);
                break;
            case 'calendar':
                content = <CalendarView topics={periodicTopics} allSubjects={allSubjects} isPeriodicView={true} />;
                break;
            case 'dashboard':
            default:
                break;
        }

        if (!content) {
            content = (
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {list.length > 0 ? (
                        list.map(topic => (
                            <TopicCard
                                key={topic.id}
                                topic={topic}
                                subjectName={topic.subjectName}
                                onMarkDone={handleMarkDoneClick}
                                onShift={() => {}}
                                onDelete={handleDeleteClick}
                                onEdit={handleOpenEditModal}
                            />
                        ))
                    ) : (
                        <div className="col-span-full py-12 text-center text-gray-500 dark:text-gray-400">
                            <h3 className="text-2xl font-semibold mb-2">No Periodic Reviews</h3>
                            <p>Add a new item or clear your filter.</p>
                        </div>
                    )}
                </div>
            );
        }

        return (
            <>
                 <div className="bg-white/60 dark:bg-black/40 backdrop-blur-xl p-2 rounded-2xl shadow-sm mb-8 border border-white/50 dark:border-white/10 flex items-center space-x-2 overflow-x-auto custom-scrollbar">
                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider ml-2 mr-2">Filters:</span>
                    <button
                        onClick={() => setSelectedSubjectFilter('all')}
                        className={`px-4 py-1.5 rounded-xl text-sm font-medium transition-all whitespace-nowrap
                            ${selectedSubjectFilter === 'all' ? 'bg-white shadow text-blue-600' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}`}
                    >
                        All Subjects
                    </button>
                    {currentSubjects.map(subject => (
                        <button
                            key={subject.id}
                            onClick={() => setSelectedSubjectFilter(subject.id)}
                            className={`px-4 py-1.5 rounded-xl text-sm font-medium transition-all whitespace-nowrap
                                ${selectedSubjectFilter === subject.id ? 'bg-white shadow text-blue-600' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}`}
                        >
                            {subject.name}
                        </button>
                    ))}
                    <div className="flex-grow"></div>
                     <Button 
                        variant="ghost" 
                        onClick={() => setIsManageRevisionSubjectsOpen(true)} 
                        className="text-xs whitespace-nowrap"
                    >
                        <Edit className="w-3 h-3 mr-1" /> Manage
                    </Button>
                </div>

                <div className="flex bg-gray-100/80 dark:bg-gray-800/80 p-1.5 rounded-2xl mb-8 sticky top-0 z-10 backdrop-blur-md shadow-sm border border-gray-200 dark:border-gray-700">
                    <button onClick={() => setActivePeriodicTab('dashboard')} className={tabClasses('dashboard', activePeriodicTab)}>
                        Dashboard
                    </button>
                    <button onClick={() => setActivePeriodicTab('pending')} className={tabClasses('pending', activePeriodicTab)}>
                        Pending ({periodicTabCounts.pending})
                    </button>
                    <button onClick={() => setActivePeriodicTab('missed')} className={tabClasses('missed', activePeriodicTab)}>
                        Missed ({periodicTabCounts.missed})
                    </button>
                    <button onClick={() => setActivePeriodicTab('done')} className={tabClasses('done', activePeriodicTab)}>
                        Done ({periodicTabCounts.done})
                    </button>
                    <button onClick={() => setActivePeriodicTab('calendar')} className={tabClasses('calendar', activePeriodicTab)}>
                        Calendar
                    </button>
                </div>
                
                {content}
            </>
        );
    };

    // --- New Random Section ---
    const RandomSection = () => {
        const [randomTopic, setRandomTopic] = useState(null);
        
        const completedTopics = useMemo(() => 
            getRevisionTopics.filter(t => t.completedCount > 0), 
        [getRevisionTopics]);

        const pickRandom = () => {
            if (completedTopics.length > 0) {
                const randomIndex = Math.floor(Math.random() * completedTopics.length);
                setRandomTopic(completedTopics[randomIndex]);
            }
        };

        useEffect(() => {
            if (!randomTopic && completedTopics.length > 0) {
                pickRandom();
            }
        }, [completedTopics]);

        return (
            <div className="flex flex-col items-center justify-center min-h-[70vh] animate-fade-in">
                <h2 className="text-3xl font-extrabold text-gray-800 dark:text-white mb-8 flex items-center">
                    <Dices className="w-10 h-10 mr-4 text-purple-500" /> Random Review
                </h2>
                
                {completedTopics.length === 0 ? (
                    <div className="text-center p-12 bg-white/60 dark:bg-black/30 backdrop-blur-xl rounded-3xl shadow-xl max-w-lg">
                        <p className="text-gray-500 dark:text-gray-400 text-lg">
                            No completed revisions yet. Complete some revisions to unlock the Random Review feature!
                        </p>
                    </div>
                ) : (
                    <div className="w-full max-w-2xl flex flex-col items-center">
                         {randomTopic && (
                            <div className="w-full transform transition-all duration-500 hover:scale-105 mb-8">
                                <TopicCard 
                                    topic={randomTopic} 
                                    subjectName={randomTopic.subjectName} 
                                    onMarkDone={() => {}} // No action for random view
                                    onShift={() => {}} 
                                    onDelete={() => {}} 
                                    onEdit={() => {}} 
                                />
                            </div>
                         )}

                         <Button onClick={pickRandom} className="py-4 px-12 text-lg shadow-2xl animate-bounce-subtle">
                            <Dices className="w-5 h-5 mr-2" /> Pick Another Card
                         </Button>
                    </div>
                )}
            </div>
        );
    };
    
    // --- Updated Reports Section ---
    const ReportsSection = () => {
        const revisionTopics = getRevisionTopics;
        const taskTopics = getTaskTopics;
        
        // --- Totals ---
        const totalRevisions = revisionTopics.length;
        const activeTasks = taskTopics.filter(t => !t.isComplete).length;
        const completedTasks = taskTopics.filter(t => t.isComplete).length;

        // --- Revision Stats Calculation ---
        const allScheduleItems = revisionTopics.flatMap(t => t.schedule || []);
        const nonLtrItems = allScheduleItems.filter(s => !s.isLongTerm);
        
        const totalScheduledRevisions = nonLtrItems.length;
        const completedRevisionsCount = nonLtrItems.filter(s => s.completed).length;
        
        // Revision Progress %
        const globalProgress = totalScheduledRevisions > 0 
            ? Math.round((completedRevisionsCount / totalScheduledRevisions) * 100) 
            : 0;

        // On Time Rate
        // Logic: If completedDate <= targetDate (approximated to day)
        const onTimeItems = nonLtrItems.filter(s => {
            if (!s.completed || !s.completedDate) return false;
            // Allow 1 day grace period for "On Time"
            return s.completedDate <= (s.targetDate + (24 * 60 * 60 * 1000));
        });
        const onTimeRate = completedRevisionsCount > 0 
            ? Math.round((onTimeItems.length / completedRevisionsCount) * 100) 
            : 100;

        // --- Stage Breakdown ---
        const stageCounts = [0, 0, 0, 0, 0]; // R1, R2, R3, R4, R5
        const completedTopicsCount = revisionTopics.filter(t => t.isComplete).length;
        
        revisionTopics.forEach(topic => {
            if (!topic.isComplete) {
                // Determine current stage based on completed count
                // completedCount = 0 -> Stage 1 pending
                // completedCount = 1 -> Stage 2 pending
                const stage = topic.completedCount;
                if (stage < 5) {
                    stageCounts[stage]++;
                }
            }
        });

        // --- Consistency Chart Data (Last 14 Days) ---
        const consistencyData = useMemo(() => {
            const data = [];
            for (let i = 13; i >= 0; i--) {
                const d = new Date();
                d.setDate(d.getDate() - i);
                d.setHours(0,0,0,0);
                const dayMs = d.getTime();
                
                // Count revisions done on this day
                const revisionsDone = nonLtrItems.filter(s => {
                    if (!s.completed || !s.completedDate) return false;
                    const compDate = new Date(s.completedDate);
                    compDate.setHours(0,0,0,0);
                    return compDate.getTime() === dayMs;
                }).length;

                data.push({
                    day: d.toLocaleDateString('en-US', { weekday: 'short' }),
                    date: d.getDate(),
                    count: revisionsDone
                });
            }
            return data;
        }, [nonLtrItems]);

        const maxConsistency = Math.max(...consistencyData.map(d => d.count), 5); // Minimum scale of 5

        const StatCard = ({ title, value, sub, colorClass, icon: Icon }) => (
            <div className={`relative bg-white/60 dark:bg-gray-800/60 backdrop-blur-xl p-6 rounded-3xl shadow-lg overflow-hidden group`}>
                <div className={`absolute top-0 left-0 w-1 h-full ${colorClass}`}></div>
                <div className="flex justify-between items-start">
                    <div>
                        <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">{title}</p>
                        <h3 className="text-3xl font-extrabold text-gray-800 dark:text-white">{value}</h3>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 font-medium">{sub}</p>
                    </div>
                    <div className={`p-3 rounded-2xl bg-white/50 dark:bg-white/5 ${colorClass.replace('bg-', 'text-')}`}>
                        <Icon className="w-6 h-6" />
                    </div>
                </div>
            </div>
        );

        return (
            <div className="space-y-8 animate-fade-in pb-12">
                <h2 className="text-3xl font-extrabold text-gray-800 dark:text-white flex items-center mb-6">
                    <BarChart3 className="w-8 h-8 mr-3 text-blue-500" /> Analytics Dashboard
                </h2>

                {/* Top Row Stats */}
                <div className="grid md:grid-cols-4 gap-6">
                    <StatCard 
                        title="Total Topics" 
                        value={totalRevisions} 
                        sub={`${completedTopicsCount} Fully Mastered`} 
                        colorClass="bg-blue-500"
                        icon={BookOpen}
                    />
                    <StatCard 
                        title="Global Progress" 
                        value={`${globalProgress}%`} 
                        sub="Of all scheduled revisions" 
                        colorClass="bg-purple-500"
                        icon={Repeat}
                    />
                    <StatCard 
                        title="On-Time Rate" 
                        value={`${onTimeRate}%`} 
                        sub="Consistency Score" 
                        colorClass="bg-green-500"
                        icon={Clock}
                    />
                    <StatCard 
                        title="Active Tasks" 
                        value={activeTasks} 
                        sub={`${completedTasks} Finished`} 
                        colorClass="bg-orange-500"
                        icon={List}
                    />
                </div>
                
                <div className="grid lg:grid-cols-3 gap-8">
                    {/* Activity Chart */}
                    <div className="lg:col-span-2 bg-white/60 dark:bg-gray-800/60 backdrop-blur-xl p-8 rounded-3xl shadow-lg border border-white/50 dark:border-white/10">
                         <h3 className="text-lg font-bold text-gray-800 dark:text-white mb-6 flex items-center">
                            <BarChart3 className="w-5 h-5 mr-2 text-blue-500"/> 14-Day Activity
                        </h3>
                        <div className="flex items-end justify-between h-48 space-x-2">
                            {consistencyData.map((d, i) => {
                                const height = (d.count / maxConsistency) * 100;
                                return (
                                    <div key={i} className="flex-1 flex flex-col items-center group">
                                        <div className="relative w-full flex items-end justify-center h-full bg-gray-100 dark:bg-gray-700/30 rounded-t-xl overflow-hidden">
                                            <div 
                                                style={{ height: `${height}%` }} 
                                                className="w-full bg-blue-500 opacity-80 group-hover:opacity-100 transition-all duration-500"
                                            ></div>
                                            {d.count > 0 && (
                                                <div className="absolute top-0 -mt-6 bg-black text-white text-[10px] py-1 px-2 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                                                    {d.count}
                                                </div>
                                            )}
                                        </div>
                                        <div className="text-[10px] text-gray-400 mt-2 font-medium uppercase">{d.day}</div>
                                    </div>
                                )
                            })}
                        </div>
                    </div>

                    {/* Pipeline / Funnel */}
                    <div className="bg-white/60 dark:bg-gray-800/60 backdrop-blur-xl p-8 rounded-3xl shadow-lg border border-white/50 dark:border-white/10">
                        <h3 className="text-lg font-bold text-gray-800 dark:text-white mb-6 flex items-center">
                            <Filter className="w-5 h-5 mr-2 text-purple-500"/> Retention Pipeline
                        </h3>
                        <div className="space-y-4">
                            {['Fresh (1d)', 'New (3d)', 'Learning (7d)', 'Reviewing (15d)', 'Mastering (30d)'].map((label, index) => (
                                <div key={index} className="relative">
                                    <div className="flex justify-between text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">
                                        <span>{label}</span>
                                        <span>{stageCounts[index]} items</span>
                                    </div>
                                    <div className="h-2 w-full bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                                        <div 
                                            style={{ width: `${(stageCounts[index] / (Math.max(...stageCounts) || 1)) * 100}%` }}
                                            className="h-full bg-gradient-to-r from-purple-500 to-indigo-500 rounded-full"
                                        ></div>
                                    </div>
                                </div>
                            ))}
                            <div className="pt-4 border-t border-gray-200 dark:border-gray-700 mt-4">
                                <div className="flex justify-between items-center">
                                    <span className="text-sm font-bold text-green-600 dark:text-green-400">Mastered Items</span>
                                    <span className="text-xl font-extrabold text-gray-800 dark:text-white">{completedTopicsCount}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50 dark:from-slate-900 dark:via-gray-900 dark:to-slate-900 text-gray-800 dark:text-white font-sans transition-colors duration-500">
             {/* Liquid Background Elements */}
            <div className="fixed top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
                 <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-400/20 dark:bg-blue-600/10 rounded-full blur-[100px] animate-blob"></div>
                 <div className="absolute top-[20%] right-[-10%] w-[35%] h-[35%] bg-purple-400/20 dark:bg-purple-600/10 rounded-full blur-[100px] animate-blob animation-delay-2000"></div>
                 <div className="absolute bottom-[-10%] left-[20%] w-[40%] h-[40%] bg-pink-400/20 dark:bg-pink-600/10 rounded-full blur-[100px] animate-blob animation-delay-4000"></div>
            </div>

            <Sidebar 
                activeSection={activeSection}
                setActiveSection={setActiveSection}
                setIsAddTopicModalOpen={setIsAddTopicModalOpen}
                setIsAddSubjectModalOpen={setIsAddSubjectModalOpen}
                setIsRecycleBinOpen={setIsRecycleBinOpen}
                deletedTopicsCount={deletedTopics.filter(t => !t.isPermanentDelete).length}
                userName={userName || 'User'}
                toggleDarkMode={toggleDarkMode}
                darkMode={darkMode}
                setIsProfileModalOpen={setIsProfileModalOpen}
                isCollapsed={isSidebarCollapsed}
                toggleSidebar={toggleSidebar}
            />

            <main className={`relative transition-all duration-300 p-6 sm:p-10 z-10 ${isSidebarCollapsed ? 'ml-24' : 'ml-72'}`}>
                {activeSection === 'revision' ? 
                    <RevisionSection 
                        handleMarkDoneClick={handleMarkDoneClick}
                        handleShift={handleShift}
                        handleDeleteClick={handleDeleteClick}
                        handleOpenEditModal={handleOpenEditModal}
                    /> 
                    : activeSection === 'tasks' ?
                    <TaskSection 
                        handleMarkDoneClick={handleMarkDoneClick}
                        handleDeleteClick={handleDeleteClick}
                        handleOpenEditModal={handleOpenEditModal}
                    />
                    : activeSection === 'periodic' ?
                    <PeriodicSection 
                        handleMarkDoneClick={handleMarkDoneClick}
                        handleDeleteClick={handleDeleteClick}
                        handleOpenEditModal={handleOpenEditModal}
                    />
                    : activeSection === 'random' ?
                    <RandomSection />
                    :
                    <ReportsSection />
                }
            </main>

            <FloatingTimerButton onClick={() => setIsTimerModalOpen(true)} />

            <AddTopicForm
                userId={userId}
                subjects={activeSection === 'tasks' ? subjects.filter(s => s.type === 'task') : subjects.filter(s => s.type === 'revision')}
                isOpen={isAddTopicModalOpen}
                onClose={() => setIsAddTopicModalOpen(false)}
                onAddTopic={handleAddTopic}
                defaultType={activeSection === 'revision' ? 'revision' : activeSection === 'tasks' ? 'task' : 'periodic'}
            />
            
            <Modal isOpen={isAddSubjectModalOpen} onClose={() => setIsAddSubjectModalOpen(false)} title={`Add New Subject (${activeSection === 'revision' || activeSection === 'periodic' || activeSection === 'random' ? 'Revision/Periodic' : 'Task'})`}>
                <AddSubjectForm 
                    userId={userId} 
                    onClose={() => setIsAddSubjectModalOpen(false)} 
                    subjectCollectionGetter={activeSection === 'revision' || activeSection === 'periodic' || activeSection === 'random' ? getRevisionSubjectsCollection : getTaskSubjectsCollection}
                />
            </Modal>
            
            {topicToEdit && (
                <EditTopicModal
                    userId={userId}
                    topic={topicToEdit}
                    subjects={subjects.filter(s => s.type === (topicToEdit.type === 'task' ? 'task' : 'revision'))}
                    isOpen={isEditTopicModalOpen}
                    onClose={() => {
                        setIsEditTopicModalOpen(false);
                        setTopicToEdit(null);
                    }}
                    onSave={handleEditTopic}
                />
            )}
            
            <ManageSubjectsModal
                isOpen={isManageRevisionSubjectsOpen}
                onClose={() => setIsManageRevisionSubjectsOpen(false)}
                subjects={subjects.filter(s => s.type === 'revision')}
                onEdit={handleEditSubject}
                title="Manage Revision/Periodic Subjects"
            />
            <ManageSubjectsModal
                isOpen={isManageTaskSubjectsOpen}
                onClose={() => setIsManageTaskSubjectsOpen(false)}
                subjects={subjects.filter(s => s.type === 'task')}
                onEdit={handleEditSubject}
                title="Manage Task Subjects"
            />
            <EditSubjectModal
                isOpen={isEditSubjectModalOpen}
                onClose={() => {
                    setIsEditSubjectModalOpen(false);
                    setEditingSubject(null);
                }}
                subject={editingSubject}
                userId={userId}
            />
            
            <RecycleBinModal
                deletedTopics={deletedTopics}
                isOpen={isRecycleBinOpen}
                onClose={() => setIsRecycleBinOpen(false)}
                onRecover={handleRecover}
                onEmptyBin={(ids) => handlePermanentDelete(ids)}
            />
            
            <TimerModal isOpen={isTimerModalOpen} onClose={() => setIsTimerModalOpen(false)} />
            
            <ProfileModal
                userId={userId}
                userName={userName}
                onSaveName={handleSaveName}
                isOpen={isProfileModalOpen}
                onClose={() => setIsProfileModalOpen(false)}
            />

            <ConfirmationModal
                isOpen={confirmAction.isOpen}
                onClose={() => setConfirmAction({ ...confirmAction, isOpen: false })}
                title={confirmAction.title}
                message={confirmAction.message}
                onConfirm={confirmAction.onConfirm}
                confirmText={confirmAction.confirmText}
            />
        </div>
    );
};

const App = () => {
    const [userId, setUserId] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [topics, setTopics] = useState([]);
    const [revisionSubjects, setRevisionSubjects] = useState([]);
    const [taskSubjects, setTaskSubjects] = useState([]);
    const [allSubjectsMap, setAllSubjectsMap] = useState({});
    const [isAppInitialized, setIsAppInitialized] = useState(false);

    const combinedSubjects = useMemo(() => [...revisionSubjects, ...taskSubjects], [revisionSubjects, taskSubjects]);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            if (user) {
                setUserId(user.uid);
            } else {
                setUserId(null);
            }
            setIsLoading(false); 
        });

        setIsAppInitialized(true); 

        return () => unsubscribe();
    }, []);

    useEffect(() => {
        if (!userId) {
            setRevisionSubjects([]);
            return;
        }

        const q = query(getRevisionSubjectsCollection(userId));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const fetchedSubjects = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id, type: 'revision' }));
            setRevisionSubjects(fetchedSubjects);
        }, (error) => {
            console.error("Error listening to revision subjects:", error);
        });

        return () => unsubscribe();
    }, [userId]);

    useEffect(() => {
        if (!userId) {
            setTaskSubjects([]);
            return;
        }

        const q = query(getTaskSubjectsCollection(userId));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const fetchedSubjects = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id, type: 'task' }));
            setTaskSubjects(fetchedSubjects);
        }, (error) => {
            console.error("Error listening to task subjects:", error);
        });

        return () => unsubscribe();
    }, [userId]);

    useEffect(() => {
        const map = combinedSubjects.reduce((acc, subject) => {
            acc[subject.id] = subject;
            return acc;
        }, {});
        setAllSubjectsMap(map);
    }, [combinedSubjects]);

    useEffect(() => {
        if (!userId) {
            setTopics([]);
            return;
        }

        const q = query(getTopicsCollection(userId));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const fetchedTopics = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
            setTopics(fetchedTopics);
        }, (error) => {
            console.error("Error listening to topics:", error);
        });

        return () => unsubscribe();
    }, [userId]);

    const deletedTopics = useMemo(() => {
        const sixtyDaysAgo = Date.now() - (60 * 24 * 60 * 60 * 1000);
        
        return topics.filter(t => t.deleted).map(t => ({
            ...t,
            isPermanentDelete: t.deletedAt && t.deletedAt < sixtyDaysAgo,
        }));
    }, [topics]);

    if (isLoading || !isAppInitialized) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 transition-colors">
                <div className="relative">
                    <div className="w-16 h-16 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
                </div>
            </div>
        );
    }

    if (!userId) {
        return <AuthScreen setUserId={setUserId} />;
    }

    return (
        <AppLogic
            userId={userId}
            topics={topics}
            subjects={combinedSubjects}
            allSubjects={allSubjectsMap}
            deletedTopics={deletedTopics}
        />
    );
};

export default App;
