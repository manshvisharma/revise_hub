// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, updatePassword } from "firebase/auth";
import { getFirestore, doc, collection, onSnapshot, setDoc, query, updateDoc, deleteDoc, writeBatch, getDoc } from "firebase/firestore";
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'; 
import { Clock, CheckCircle, XCircle, Plus, LayoutDashboard, Calendar, Users, User, List, Trash2, RotateCcw, Timer, BookOpen, Edit, ChevronRight, BarChart3, Lock, Sun, Moon } from 'lucide-react';

// --- Firebase Configuration (Hardcoded with User's provided values for deployment) ---
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

// Helper function for exponential backoff (retry logic for API calls)
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
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const dateToISOString = (date) => {
    if (!date) return '';
    const d = date.toDate ? date.toDate() : new Date(date);
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

const getStatusText = (currentRevision, totalRevisions, type) => {
    if (type === 'task') {
        return 'Study Task';
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

// --- CORE UI COMPONENTS ---

const Button = ({ children, onClick, className = '', disabled = false, variant = 'primary', type = 'button' }) => {
    let baseStyle = 'shadow-md font-semibold transition-all duration-200 focus:outline-none rounded-lg ';
    let colorStyle = '';

    switch (variant) {
        case 'primary':
            colorStyle = 'bg-blue-600 hover:bg-blue-700 text-white';
            break;
        case 'secondary':
            colorStyle = 'bg-gray-200 hover:bg-gray-300 text-gray-800 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-200';
            break;
        case 'success':
            colorStyle = 'bg-green-500 hover:bg-green-600 text-white';
            break;
        case 'danger':
            colorStyle = 'bg-red-500 hover:bg-red-600 text-white';
            break;
        case 'info':
            colorStyle = 'bg-yellow-500 hover:bg-yellow-600 text-white';
            break;
        case 'outline':
            colorStyle = 'border border-gray-300 hover:bg-gray-100 text-gray-700 shadow-none dark:border-gray-600 dark:hover:bg-gray-700 dark:text-gray-200';
            break;
        case 'disabled':
            colorStyle = 'bg-gray-300 text-gray-500 cursor-not-allowed shadow-none';
            break;
        default:
            colorStyle = 'bg-blue-600 hover:bg-blue-700 text-white';
            break;
    }

    if (disabled) {
        colorStyle = 'bg-gray-300 text-gray-500 cursor-not-allowed shadow-none dark:bg-gray-700 dark:text-gray-400';
    }

    return (
        <button
            onClick={!disabled ? onClick : undefined}
            className={`${baseStyle} ${colorStyle} ${className} px-4 py-2 text-sm`}
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
        <div className="fixed inset-0 z-[90] overflow-y-auto" style={{ backgroundColor: 'rgba(0,0,0,0.75)' }} onClick={onClose}>
            <div className="flex items-center justify-center min-h-screen p-4" onClick={e => e.stopPropagation()}>
                <div className={`bg-white rounded-xl shadow-2xl w-full max-w-sm ${size} transform transition-all dark:bg-gray-800`}>
                    <div className="px-6 py-4 border-b flex justify-between items-center dark:border-gray-700">
                        <h3 className="text-xl font-bold text-gray-800 dark:text-gray-200">{title}</h3>
                        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors dark:text-gray-500 dark:hover:text-gray-400" type="button">
                            <XCircle className="h-6 w-6" />
                        </button>
                    </div>
                    <div className="p-6">
                        {children}
                    </div>
                </div>
            </div>
        </div>
    );
};

const ConfirmationModal = ({ isOpen, onClose, title, message, onConfirm, confirmText = 'Confirm' }) => {
    if (!isOpen) return null;

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={title}>
            <p className="text-gray-700 mb-6 dark:text-gray-300">{message}</p>
            <div className="flex justify-end space-x-3">
                <Button variant="secondary" onClick={onClose}>Cancel</Button>
                <Button variant="danger" onClick={() => { onConfirm(); onClose(); }}>{confirmText}</Button>
            </div>
        </Modal>
    );
};

// --- AuthScreen Component ---

const AuthScreen = ({ setUserId }) => {
    const [isLogin, setIsLogin] = useState(true);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [successMessage, setSuccessMessage] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setSuccessMessage('');
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
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4 dark:bg-gray-900">
            <div className="bg-white p-8 rounded-xl shadow-2xl w-full max-w-sm dark:bg-gray-800">
                <h2 className="text-3xl font-bold text-gray-800 text-center mb-6 dark:text-gray-200">
                    {isLogin ? 'Login' : 'Register'}
                </h2>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <input
                        type="email"
                        placeholder="Email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 transition-colors bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200 dark:placeholder-gray-400"
                        disabled={loading}
                    />
                    <input
                        type="password"
                        placeholder="Password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 transition-colors bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200 dark:placeholder-gray-400"
                        disabled={loading}
                    />

                    {error && (
                        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg text-sm dark:bg-red-900 dark:border-red-800 dark:text-red-200" role="alert">
                            {error}
                        </div>
                    )}
                    {successMessage && (
                        <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded-lg text-sm dark:bg-green-900 dark:border-green-800 dark:text-green-200" role="alert">
                            {successMessage}
                        </div>
                    )}

                    <Button type="submit" variant="primary" className="w-full" disabled={loading}>
                        {loading ? 'Processing...' : (isLogin ? 'Sign In' : 'Create Account')}
                    </Button>
                </form>

                <p className="mt-6 text-center text-sm dark:text-gray-400">
                    {isLogin ? "Don't have an account?" : "Already have an account?"}
                    <button
                        onClick={() => {
                            setIsLogin(!isLogin);
                            setError('');
                            setSuccessMessage('');
                            setEmail('');
                            setPassword('');
                        }}
                        className="text-blue-600 hover:text-blue-800 font-semibold ml-1 transition-colors dark:text-blue-400 dark:hover:text-blue-300"
                        disabled={loading}
                    >
                        {isLogin ? 'Register' : 'Login'}
                    </button>
                </p>
            </div>
        </div>
    );
};

// --- Profile Components and Logic ---

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

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="User Profile & Settings" size="sm:max-w-xl">
            <div className="space-y-6">
                <div className="p-4 bg-blue-50 rounded-lg border border-blue-200 dark:bg-blue-900/20 dark:border-blue-800">
                    <h4 className="font-bold text-lg text-blue-800 flex items-center dark:text-blue-200"><User className="w-5 h-5 mr-2" /> Account Details</h4>
                    <p className="text-sm text-gray-700 mt-2 dark:text-gray-300">Email: <span className="font-medium text-blue-700 dark:text-blue-300">{currentUser?.email || 'N/A'}</span></p>
                    <p className="text-sm text-gray-700 dark:text-gray-300">User ID: <code className="text-xs text-blue-700 dark:text-blue-300">{userId}</code></p>
                </div>

                <div className="p-4 border rounded-lg dark:border-gray-700">
                    <h4 className="font-bold text-lg text-gray-800 flex items-center mb-3 dark:text-gray-200"><Edit className="w-5 h-5 mr-2" /> Change Display Name</h4>
                    <form onSubmit={handleSaveName} className="flex space-x-3">
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Your Display Name"
                            required
                            className="flex-grow p-2 border border-gray-300 rounded-lg bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200"
                            disabled={isSavingName}
                        />
                        <Button type="submit" variant="primary" disabled={isSavingName || name === userName}>
                            {isSavingName ? 'Saving...' : 'Save Name'}
                        </Button>
                    </form>
                </div>

                <div className="p-4 border rounded-lg dark:border-gray-700">
                    <h4 className="font-bold text-lg text-gray-800 flex items-center mb-3 dark:text-gray-200"><Lock className="w-5 h-5 mr-2" /> Change Password</h4>
                    <form onSubmit={handleChangePassword} className="space-y-3">
                        <input
                            type="password"
                            placeholder="New Password (min 6 chars)"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            className="w-full p-2 border border-gray-300 rounded-lg bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200 dark:placeholder-gray-400"
                            disabled={isChangingPassword}
                        />
                        <input
                            type="password"
                            placeholder="Confirm New Password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            required
                            className="w-full p-2 border border-gray-300 rounded-lg bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200 dark:placeholder-gray-400"
                            disabled={isChangingPassword}
                        />
                         {passwordError && (
                            <div className="bg-red-100 text-red-700 p-2 rounded-lg text-sm dark:bg-red-900 dark:text-red-200">{passwordError}</div>
                        )}
                        {passwordSuccess && (
                            <div className="bg-green-100 text-green-700 p-2 rounded-lg text-sm dark:bg-green-900 dark:text-green-200">{passwordSuccess}</div>
                        )}
                        <div className="flex justify-end">
                            <Button type="submit" variant="danger" disabled={isChangingPassword || !password || !confirmPassword}>
                                {isChangingPassword ? 'Updating...' : 'Change Password'}
                            </Button>
                        </div>
                    </form>
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
        <Modal isOpen={isOpen} onClose={onClose} title="Problem Solving Timer" size="sm:max-w-md">
            <div className="flex flex-col items-center space-y-6">
                <div className="text-6xl sm:text-7xl font-mono font-bold text-gray-800 bg-gray-100 p-6 rounded-xl shadow-inner w-full text-center dark:text-gray-200 dark:bg-gray-700">
                    {formatTime(time)}
                </div>
                <div className="flex space-x-4">
                    <Button 
                        variant={isRunning ? 'danger' : 'success'} 
                        onClick={() => setIsRunning(!isRunning)}
                        className="py-3 px-6 text-lg"
                    >
                        {isRunning ? 'Pause' : 'Start'}
                    </Button>
                    <Button 
                        variant="secondary" 
                        onClick={handleReset} 
                        disabled={time === 0}
                        className="py-3 px-6 text-lg"
                    >
                        Reset
                    </Button>
                </div>
            </div>
        </Modal>
    );
};

// --- Recycle Bin Modal ---

const RecycleBinModal = ({ deletedTopics, isOpen, onClose, onRecover, onEmptyBin }) => {
    const activeDeletedTopics = deletedTopics.filter(t => !t.isPermanentDelete);

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Recycle Bin" size="sm:max-w-2xl">
            <p className="text-sm text-gray-600 mb-4 dark:text-gray-400">
                Items are permanently deleted 60 days after being moved here.
            </p>
            <div className="flex justify-between items-center mb-4 border-b pb-2 dark:border-gray-700">
                <span className="font-semibold text-gray-700 dark:text-gray-300">Total Items: {activeDeletedTopics.length}</span>
                <Button 
                    variant="danger" 
                    onClick={() => onEmptyBin(activeDeletedTopics.map(t => t.id))}
                    disabled={activeDeletedTopics.length === 0}
                    className="text-xs py-1 px-3"
                >
                    Empty Bin Now
                </Button>
            </div>
            
            <div className="space-y-3 max-h-96 overflow-y-auto pr-2">
                {activeDeletedTopics.length === 0 ? (
                    <div className="text-center p-8 bg-gray-100 rounded-lg dark:bg-gray-700">
                        <Trash2 className="w-8 h-8 mx-auto text-gray-400 mb-2 dark:text-gray-500"/>
                        <p className="text-gray-600 dark:text-gray-400">Recycle Bin is empty.</p>
                    </div>
                ) : (
                    activeDeletedTopics.map(topic => (
                        <div key={topic.id} className="p-4 bg-white rounded-lg border border-gray-200 flex justify-between items-center shadow-sm dark:bg-gray-800 dark:border-gray-700">
                            <div>
                                <p className="font-semibold text-gray-800 dark:text-gray-200">{topic.name}</p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">Deleted: {dateToString(topic.deletedAt)}</p>
                            </div>
                            <Button variant="success" onClick={() => onRecover(topic.id)} className="text-xs py-1 px-3">
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
            <div className="space-y-3 max-h-60 overflow-y-auto pr-2">
                {subjects.length === 0 ? (
                    <p className="text-gray-500 text-center py-4 dark:text-gray-400">No subjects yet. Add one to get started.</p>
                ) : (
                    subjects.map(subject => (
                        <div key={subject.id} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg border dark:bg-gray-700 dark:border-gray-600">
                            <span className="font-medium text-gray-800 dark:text-gray-200">{subject.name}</span>
                            <Button 
                                variant="outline" 
                                onClick={() => {
                                    onEdit(subject);
                                    onClose();
                                }} 
                                className="text-xs px-3 py-1"
                            >
                                <Edit className="w-3 h-3 mr-1" /> Edit
                            </Button>
                        </div>
                    ))
                )}
            </div>
            <div className="flex justify-end space-x-2 mt-4 pt-2 border-t dark:border-gray-700">
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
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 mb-4 bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200 dark:placeholder-gray-400"
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

const SubtopicInputList = ({ subtopics, setSubtopics, disabled }) => {
    const nextSubtopicId = useRef(0);

    useEffect(() => {
        const maxId = subtopics.reduce((max, sub) => Math.max(max, sub.id || 0), 0);
        nextSubtopicId.current = Math.max(maxId + 1, Date.now()); 
    }, [subtopics]);

    const addSubtopic = () => {
        const newId = nextSubtopicId.current++;
        setSubtopics([...subtopics, { id: newId, name: '', number: '' }]);
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
        <div className="space-y-3 p-4 bg-gray-50 rounded-lg border dark:bg-gray-700/50 dark:border-gray-600">
            <h4 className="text-base font-semibold text-gray-700 dark:text-gray-300">Subtopics / Problems (Optional)</h4>
            
            <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
                {subtopics.map((sub) => (
                    <div key={sub.id} className="flex items-center space-x-2 bg-white p-2 border rounded-lg shadow-sm dark:bg-gray-800 dark:border-gray-600">
                        <input
                            type="text"
                            value={sub.name}
                            onChange={(e) => updateSubtopic(sub.id, 'name', e.target.value)}
                            placeholder="Subtopic Name / Problem Title"
                            className="flex-3 p-2 border border-gray-200 rounded-lg text-sm w-full bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200 dark:placeholder-gray-400"
                            disabled={disabled}
                        />
                        <input
                            type="text"
                            value={sub.number}
                            onChange={(e) => updateSubtopic(sub.id, 'number', e.target.value)}
                            placeholder="No."
                            className="flex-1 w-1/4 p-2 border border-gray-200 rounded-lg text-sm text-center bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200 dark:placeholder-gray-400"
                            disabled={disabled}
                        />
                        <button
                            type="button" 
                            onClick={(e) => { e.stopPropagation(); removeSubtopic(sub.id); }} 
                            className="text-red-500 hover:text-red-700 disabled:opacity-50 flex-shrink-0"
                            disabled={disabled}
                        >
                            <XCircle className="h-5 w-5" />
                        </button>
                    </div>
                ))}
            </div>

            <Button 
                type="button" 
                onClick={(e) => { e.stopPropagation(); addSubtopic(); }} 
                variant="secondary"
                className="w-full justify-center text-blue-600 bg-blue-100 hover:bg-blue-200 disabled:opacity-50 dark:text-blue-400 dark:bg-blue-900/30 dark:hover:bg-blue-900/50"
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
            .map(sub => ({ name: sub.name.trim(), number: sub.number.trim() }));
        
        let finalTaskDueDate = null;
        if (type === 'task') {
            if (taskSchedule === 'specific') {
                finalTaskDueDate = taskDueDate ? new Date(taskDueDate).getTime() : null;
            } else if (taskSchedule === 'tomorrow') {
                finalTaskDueDate = TOMORROW_MS;
            } else if (taskSchedule === 'today') {
                finalTaskDueDate = TODAY_MS;
            }
        }

        try {
            await onAddTopic({
                type,
                name: topicName.trim(),
                subjectId: selectedSubjectId,
                initialStudyDate: type === 'revision' ? studyDate.getTime() : null,
                taskDueDate: finalTaskDueDate,
                subtopics: cleanedSubtopics,
                enableLtr: type === 'revision' ? enableLtr : false
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
    const hasSubjects = subjects.length > 0;

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Add New Study Item">
            <form onSubmit={handleSubmit}>
                <div className="flex space-x-4 mb-4 justify-center">
                    <Button 
                        type="button" 
                        onClick={() => setType('revision')} 
                        variant={isRevision ? 'primary' : 'outline'} 
                        className="flex-1"
                    >
                        Spaced Revision
                    </Button>
                    <Button 
                        type="button" 
                        onClick={() => setType('task')} 
                        variant={!isRevision ? 'primary' : 'outline'} 
                        className="flex-1"
                    >
                        Study Task (Todo)
                    </Button>
                </div>

                <input
                    type="text"
                    value={topicName}
                    onChange={(e) => setTopicName(e.target.value)}
                    placeholder={isRevision ? "Topic Name" : "Task Name (e.g., Read Chapter 3)"}
                    required
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 mb-4 bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200 dark:placeholder-gray-400"
                    disabled={loading}
                />
                
                <div className="flex flex-col sm:flex-row sm:space-x-4 space-y-4 sm:space-y-0 mb-4">
                    <select
                        value={selectedSubjectId}
                        onChange={(e) => setSelectedSubjectId(e.target.value)}
                        required
                        className="flex-1 w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200"
                        disabled={loading || !hasSubjects}
                    >
                        {!hasSubjects && <option value="">No Subjects Added</option>}
                        {subjects.map(subject => (
                            <option key={subject.id} value={subject.id}>{subject.name}</option>
                        ))}
                    </select>
                    
                    {isRevision ? (
                        <input
                            type="date"
                            value={initialDate}
                            onChange={(e) => setInitialDate(e.target.value)}
                            required
                            title="Original Study Date (Used to calculate schedule)"
                            className="w-full sm:w-1/2 p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 dark:border-gray-600"
                            disabled={loading}
                        />
                    ) : (
                        <div className="w-full sm:w-1/2 space-y-2">
                             <select
                                value={taskSchedule}
                                onChange={(e) => { setTaskSchedule(e.target.value); if (e.target.value !== 'specific') setTaskDueDate(dateToISOString(TODAY_MS)); }}
                                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200"
                                disabled={loading}
                            >
                                <option value="today">Schedule Today</option>
                                <option value="tomorrow">Schedule Tomorrow</option>
                                <option value="specific">Schedule Specific Date</option>
                                <option value="recommended">Add to Recommended List</option>
                            </select>
                            {taskSchedule === 'specific' && (
                                <input
                                    type="date"
                                    value={taskDueDate}
                                    onChange={(e) => setTaskDueDate(e.target.value)}
                                    required
                                    title="Specific Due Date"
                                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 dark:border-gray-600"
                                    disabled={loading}
                                />
                            )}
                            {taskSchedule === 'recommended' && (
                                <p className="text-xs text-gray-500 p-1 dark:text-gray-400">No due date. Appears in "Recommended" tab.</p>
                            )}
                        </div>
                    )}
                </div>

                <SubtopicInputList subtopics={subtopics} setSubtopics={setSubtopics} disabled={loading} />

                {isRevision && (
                    <div className="mt-4 flex items-center space-x-2 bg-purple-50 p-3 rounded-lg border border-purple-200 dark:bg-purple-900/20 dark:border-purple-800">
                        <input 
                            type="checkbox" 
                            id="enableLtr" 
                            checked={enableLtr} 
                            onChange={(e) => setEnableLtr(e.target.checked)}
                            className="w-4 h-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500"
                        />
                        <label htmlFor="enableLtr" className="text-sm font-medium text-purple-800 dark:text-purple-200">
                            Enable Long-Term Review (45 Days after final revision)
                        </label>
                    </div>
                )}

                <div className="flex justify-end space-x-2 mt-4">
                    <Button variant="secondary" onClick={onClose} disabled={loading}>Cancel</Button>
                    <Button type="submit" variant="primary" disabled={loading || !topicName.trim() || !selectedSubjectId}>
                        {loading ? 'Saving...' : `Save ${isRevision ? 'Topic' : 'Task'}`}
                    </Button>
                </div>
            </form>
        </Modal>
    );
};

const EditTopicModal = ({ userId, topic, subjects, isOpen, onClose, onSave }) => {
    const initialStudyDateString = topic ? dateToISOString(topic.initialStudyDate) : dateToISOString(TODAY_MS);
    
    const [topicName, setTopicName] = useState('');
    const [initialDate, setInitialDate] = useState(initialStudyDateString);
    const [taskDueDate, setTaskDueDate] = useState('');
    const [selectedSubjectId, setSelectedSubjectId] = useState('');
    const [subtopics, setSubtopics] = useState([]); 
    const [enableLtr, setEnableLtr] = useState(false);
    const [loading, setLoading] = useState(false);
    
    useEffect(() => {
        if (topic && isOpen) {
            setTopicName(topic.name || '');
            setSelectedSubjectId(topic.subjectId || '');
            setInitialDate(topic.type === 'revision' ? dateToISOString(topic.initialStudyDate) : dateToISOString(TODAY_MS));
            setTaskDueDate(topic.taskDueDate ? dateToISOString(topic.taskDueDate) : '');
            setEnableLtr(topic.enableLtr || false);
            setSubtopics(topic.subtopics?.map((sub, index) => ({...sub, id: sub.id || Date.now() + index})) || []);
        }
    }, [topic, isOpen]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!topicName.trim() || !selectedSubjectId || !userId || !topic) return;

        setLoading(true);
        
        const cleanedSubtopics = subtopics
            .filter(sub => sub.name.trim() !== '')
            .map(sub => ({ name: sub.name.trim(), number: sub.number.trim() }));
        
        try {
            await onSave(topic.id, topicName.trim(), selectedSubjectId, initialDate, cleanedSubtopics, enableLtr, taskDueDate);
            onClose();
        } catch (error) {
            console.error('Error saving edited topic:', error);
        } finally {
            setLoading(false);
        }
    };

    const isRevision = topic?.type === 'revision';

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`Edit ${topic?.type === 'revision' ? 'Topic' : 'Task'}: ${topic?.name || ''}`}>
            <form onSubmit={handleSubmit}>
                <input
                    type="text"
                    value={topicName}
                    onChange={(e) => setTopicName(e.target.value)}
                    placeholder="Topic Name"
                    required
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 mb-4 bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200 dark:placeholder-gray-400"
                    disabled={loading}
                />
                <div className="flex flex-col sm:flex-row sm:space-x-4 space-y-4 sm:space-y-0 mb-4">
                    <select
                        value={selectedSubjectId}
                        onChange={(e) => setSelectedSubjectId(e.target.value)}
                        required
                        className="flex-1 w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200"
                        disabled={loading || subjects.length === 0}
                    >
                        {subjects.length === 0 && <option value="">No Subjects Added</option>}
                        {subjects.map(subject => (
                            <option key={subject.id} value={subject.id}>{subject.name}</option>
                        ))}
                    </select>
                    
                    {isRevision ? (
                        <input
                            type="date"
                            value={initialDate}
                            onChange={(e) => setInitialDate(e.target.value)}
                            required
                            title="Original Study Date (Changing this recalculates the schedule)"
                            className="w-full sm:w-1/2 p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 dark:border-gray-600"
                            disabled={loading}
                        />
                    ) : (
                         <input
                            type="date"
                            value={taskDueDate}
                            onChange={(e) => setTaskDueDate(e.target.value)}
                            title="Due Date for this task (leave empty for 'Recommended')"
                            className="w-full sm:w-1/2 p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 dark:border-gray-600"
                            disabled={loading}
                        />
                    )}
                </div>
                <p className='text-xs text-yellow-600 bg-yellow-50 p-2 rounded-lg mb-4 dark:text-yellow-400 dark:bg-yellow-900/20'>
                    {isRevision 
                        ? `*Changing the Study Date will regenerate the entire revision schedule (revisions completed so far will be lost).` 
                        : `*Optional: Task Due Date is used for Pending reminders. Leave empty for "Recommended" tab.`}
                </p>
                
                <SubtopicInputList subtopics={subtopics} setSubtopics={setSubtopics} disabled={loading} />

                {isRevision && (
                    <div className="mt-4 flex items-center space-x-2 bg-purple-50 p-3 rounded-lg border border-purple-200 dark:bg-purple-900/20 dark:border-purple-800">
                        <input 
                            type="checkbox" 
                            id="enableLtr-edit" 
                            checked={enableLtr} 
                            onChange={(e) => setEnableLtr(e.target.checked)}
                            className="w-4 h-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500"
                        />
                        <label htmlFor="enableLtr-edit" className="text-sm font-medium text-purple-800 dark:text-purple-200">
                            Enable Long-Term Review (45 Days after final revision)
                        </label>
                    </div>
                )}

                <div className="flex justify-end space-x-2 mt-4">
                    <Button variant="secondary" onClick={onClose} disabled={loading}>Cancel</Button>
                    <Button type="submit" variant="primary" disabled={loading || !topicName.trim() || !selectedSubjectId}>
                        {loading ? 'Saving...' : 'Save Changes'}
                    </Button>
                </div>
            </form>
        </Modal>
    );
};

// --- Calendar View Component ---

const CalendarView = ({ topics, allSubjects, isTaskView = false }) => {
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
                        subjectName: allSubjects[topic.subjectId]?.name || 'Unknown',
                        isMissed: topic.taskDueDate < TODAY_MS,
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
                            subjectName: allSubjects[topic.subjectId]?.name || 'Unknown',
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
                        subjectName: allSubjects[topic.subjectId]?.name || 'Unknown',
                        isMissed: topic.taskDueDate < TODAY_MS,
                    });
                }
            });
        }
        return map;
    }, [topics, allSubjects, isTaskView]);

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
        <div className="p-4 bg-white rounded-xl shadow-lg dark:bg-gray-800">
            <header className="flex justify-between items-center mb-6">
                <Button onClick={handlePrevMonth} variant="secondary">
                    ←
                </Button>
                <div className="text-xl font-bold text-gray-800 flex flex-col items-center dark:text-gray-200">
                    {currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                    <Button onClick={handleToday} variant="secondary" className="mt-2 py-1 px-3 text-xs">Jump to Today</Button>
                </div>
                <Button onClick={handleNextMonth} variant="secondary">
                    →
                </Button>
            </header>

            <div className="grid grid-cols-7 gap-1 text-center font-medium text-sm text-gray-500 mb-2 dark:text-gray-400">
                {daysOfWeek.map(day => (
                    <div key={day} className="py-2 text-blue-600 font-bold dark:text-blue-400">{day}</div>
                ))}
            </div>

            <div className="grid grid-cols-7 gap-1">
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
                    
                    const cellClasses = `h-20 flex flex-col items-center justify-center p-1 rounded-lg transition-colors cursor-pointer 
                                         ${isToday ? 'bg-blue-100 border-2 border-blue-500 dark:bg-blue-900/30' : 'bg-gray-50 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600'}
                                         ${isSelected ? 'bg-purple-200 border-purple-500 dark:bg-purple-900/30' : ''}`;

                    return (
                        <div key={day} className={cellClasses} onClick={() => handleDayClick(day)}>
                            <span className={`font-semibold ${isToday ? 'text-blue-700 dark:text-blue-300' : 'text-gray-800 dark:text-gray-200'} text-lg`}>{day}</span>
                            {hasItems && (
                                <span className={`text-xs mt-1 px-2 py-0.5 rounded-full font-bold ${itemsDue.some(r => r.isMissed) ? 'bg-red-500 text-white' : 'bg-green-500 text-white'}`}>
                                    {itemsDue.length} {isTaskView ? 'Due' : 'Due'}
                                </span>
                            )}
                        </div>
                    );
                })}
            </div>

            <Modal 
                isOpen={modalOpen} 
                onClose={() => setSelectedDate(null)} 
                title={`${isTaskView ? 'Tasks' : 'Schedule'} for ${dateToString(selectedDate)}`}
                size="sm:max-w-xl"
            >
                {selectedDate && itemMap.has(dateToISOString(selectedDate)) ? (
                    <div className="space-y-3 max-h-96 overflow-y-auto pr-2">
                        {itemMap.get(dateToISOString(selectedDate)).map((item, index) => (
                            <div 
                                key={index} 
                                className={`p-3 rounded-lg shadow-sm border-l-4 
                                    ${item.isMissed ? 'bg-red-50 border-red-500 dark:bg-red-900/20 dark:border-red-800' : item.type === 'Task' ? 'bg-purple-50 border-purple-500 dark:bg-purple-900/20 dark:border-purple-800' : 'bg-green-50 border-green-500 dark:bg-green-900/20 dark:border-green-800'}`}
                            >
                                <p className="font-semibold text-gray-800 dark:text-gray-200">{item.topicName}</p>
                                <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400">
                                    <span>Subject: {item.subjectName}</span>
                                    <span className="font-bold">
                                        {item.isMissed ? '(MISSED)' : item.type === 'Task' ? '(TASK DUE)' : '(REVISION DUE)'}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <p className="text-gray-500 dark:text-gray-400">Nothing scheduled for this date. Go enjoy the break!</p>
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
    const [darkMode, setDarkMode] = useState(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('darkMode');
            return saved !== null ? JSON.parse(saved) : false;
        }
        return false;
    });

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
    const [userName, setUserName] = useState('');

    useEffect(() => {
        if (typeof document !== 'undefined') {
            document.documentElement.classList.remove('dark');
            if (darkMode) {
                document.documentElement.classList.add('dark');
            }
        }
    }, [darkMode]);

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
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 mb-4 bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200 dark:placeholder-gray-400"
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

    const handleEditTopic = useCallback(async (topicId, name, subjectId, initialDateString, subtopics, enableLtr, taskDueDateString) => {
        if (!userId || !topicId) return; 
        
        const topicRef = doc(getTopicsCollection(userId), topicId);
        const existingTopic = topics.find(t => t.id === topicId);
        
        const newStudyDate = new Date(initialDateString);
        newStudyDate.setHours(0, 0, 0, 0);
        const newStudyDateMs = newStudyDate.getTime();
        const originalStudyDateMs = existingTopic.initialStudyDate;
        
        let updateData = {
            name: name,
            subjectId: subjectId,
            subtopics: subtopics,
        };
        
        if (existingTopic.type === 'revision') {
            updateData.enableLtr = enableLtr;

            const dateChanged = newStudyDateMs !== originalStudyDateMs;
            const ltrChanged = existingTopic.enableLtr !== enableLtr;

            if (dateChanged || ltrChanged) {
                updateData.initialStudyDate = newStudyDateMs;
                updateData.schedule = generateSchedule(newStudyDate, enableLtr);
            }
        } else if (existingTopic.type === 'task') {
            updateData.taskDueDate = taskDueDateString ? new Date(taskDueDateString).getTime() : null;
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
            
            const completedCount = topic.schedule?.filter(s => s.completed)?.length || 0;
            let nextRevision = topic.schedule?.find(s => !s.completed) || null;
            
            if (type === 'revision' && topic.enableLtr && completedCount === REVISION_SCHEDULE.length) {
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

            const isComplete = (topic.type === 'task' && topic.isComplete) || (!nextRevision && topic.type === 'revision'); 
            
            let isPending = false;
            let isMissed = false;
            let isTaskPending = false; 

            if (type === 'revision' && nextRevision) {
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
                subjectName: allSubjects[topic.subjectId]?.name || 'Unknown Subject',
            };
        });
    }, [topics, allSubjects]);
    
    const getRevisionTopics = useMemo(() => processedTopics.filter(t => t.type === 'revision'), [processedTopics]);
    const getTaskTopics = useMemo(() => processedTopics.filter(t => t.type === 'task'), [processedTopics]);

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
        `flex-1 text-center py-2 font-semibold transition-colors rounded-t-lg text-xs sm:text-sm 
        ${currentActive === tab ? 'bg-white shadow-inner text-blue-600 border-b-2 border-blue-600 dark:bg-gray-800 dark:text-blue-400 dark:border-blue-500' : 'text-gray-600 hover:text-blue-500 dark:text-gray-400 dark:hover:text-blue-400'}`
    );

    const TopicCard = ({ topic, subjectName, onMarkDone, onShift, onDelete, onEdit }) => {
        const totalRevisions = REVISION_SCHEDULE.length;
        const completedRevisions = topic.schedule?.filter(s => s.completed && !s.isLongTerm)?.length || 0;
        const currentRevision = topic.schedule?.find(s => !s.completed) || null;
        
        const isComplete = topic.type === 'task' ? topic.isComplete : (!currentRevision && topic.type === 'revision'); 
        
        const statusText = getStatusText(currentRevision, totalRevisions, topic.type);
        const isMissed = statusText.startsWith('Missed') || topic.isMissed;
        const isDue = statusText.includes('Due Today');
        
        const nextDate = topic.type === 'task' 
            ? (topic.taskDueDate ? new Date(topic.taskDueDate) : null)
            : (currentRevision ? new Date(currentRevision.targetDate) : null);
        
        const initialStudyDate = topic.type === 'revision' ? dateToString(topic.initialStudyDate) : dateToString(topic.createdAt);
        
        const progressPercent = topic.type === 'revision' ? (completedRevisions / totalRevisions) * 100 : 0;
        const hasSubtopics = topic.subtopics && topic.subtopics.length > 0;

        let cardBorder = 'border-gray-200';
        let statusColor = 'text-gray-600';
        let typeBadge = '';
        
        if (topic.type === 'revision') {
            if (isComplete) {
                cardBorder = 'border-green-400';
                statusColor = 'text-green-600';
            } else if (isDue) {
                cardBorder = 'border-blue-500 ring-2 ring-blue-100';
                statusColor = 'text-blue-600';
            } else if (isMissed) {
                cardBorder = 'border-red-500 ring-2 ring-red-100';
                statusColor = 'text-red-600';
            } else if (nextDate && nextDate.getTime() < (TODAY_MS + (3 * 24 * 60 * 60 * 1000))) {
                cardBorder = 'border-yellow-400';
                statusColor = 'text-yellow-600';
            }
            typeBadge = 'Revision Topic';
        } else if (topic.type === 'task') {
            typeBadge = 'Study Task';
            if (topic.isComplete) {
                cardBorder = 'border-green-400';
                statusColor = 'text-green-600';
            } else if (isMissed) {
                cardBorder = 'border-red-500 ring-2 ring-red-100';
                statusColor = 'text-red-600';
            } else if (topic.isTaskPending) {
                cardBorder = 'border-orange-500 ring-2 ring-orange-100';
                statusColor = 'text-orange-600';
            } else {
                cardBorder = 'border-purple-400';
            }
        }

        return (
            <div className={`bg-white border-l-4 ${cardBorder} rounded-xl shadow-lg p-5 flex flex-col space-y-3 dark:bg-gray-800 dark:border-gray-700`}>
                <div className="flex justify-between items-start">
                    <div>
                        <h4 className="text-xl font-bold text-gray-800 dark:text-gray-200">{topic.name}</h4>
                        <div className="flex flex-wrap gap-2 mt-1">
                            <span className="text-sm font-medium text-purple-600 bg-purple-100 px-2 py-0.5 rounded-full inline-block dark:text-purple-400 dark:bg-purple-900/30">
                                {subjectName}
                            </span>
                            <span className="text-xs font-semibold text-gray-700 bg-gray-100 px-2 py-0.5 rounded-full inline-block dark:text-gray-300 dark:bg-gray-700">
                                {typeBadge}
                            </span>
                        </div>
                        <p className="text-xs text-gray-500 mt-2 dark:text-gray-400">
                            {topic.type === 'revision' ? 'First Studied:' : 'Created/Due:'} <span className="font-semibold text-gray-700 dark:text-gray-300">{initialStudyDate}</span>
                        </p>
                    </div>
                    <div className={`text-right text-sm font-semibold ${statusColor}`}>
                        {topic.type === 'task' && topic.isComplete ? 'Completed' : statusText}
                        {topic.type === 'revision' && !topic.isComplete && (
                            <div className="text-xs text-gray-500 mt-1 dark:text-gray-400">
                                Rev: {completedRevisions}/{totalRevisions}
                            </div>
                        )}
                        {topic.type === 'task' && nextDate && !topic.isComplete && (
                             <div className="text-xs text-gray-500 mt-1 dark:text-gray-400">
                                 Due: {dateToString(nextDate)}
                             </div>
                        )}
                    </div>
                </div>

                {hasSubtopics && (
                    <div className="bg-gray-50 p-3 rounded-lg border border-gray-100 max-h-40 overflow-y-auto dark:bg-gray-700 dark:border-gray-600">
                        <h5 className="text-xs font-bold text-gray-600 mb-2 border-b pb-1 dark:text-gray-400 dark:border-gray-500">Problems ({topic.subtopics.length})</h5>
                        <ul className="space-y-1">
                            {topic.subtopics.map((sub, index) => (
                                <li key={index} className="flex justify-between text-sm text-gray-800 dark:text-gray-200">
                                    <span className="font-medium truncate">{sub.name}</span>
                                    <span className="text-xs font-mono bg-gray-200 px-2 rounded-full text-gray-700 ml-2 flex-shrink-0 dark:bg-gray-600 dark:text-gray-300">
                                        {sub.number || 'No #'}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
                
                 {topic.type === 'revision' && (
                    <div className="pt-2">
                        <div className="h-2 bg-gray-200 rounded-full overflow-hidden dark:bg-gray-600">
                            <div
                                className={`h-full bg-green-500 transition-all duration-500`}
                                style={{ width: `${progressPercent}%` }}
                            ></div>
                        </div>
                    </div>
                 )}

                <div className="flex space-x-2 pt-2 border-t border-gray-100 dark:border-gray-700">
                    {!isComplete && (
                        <Button 
                            variant="success" 
                            onClick={() => onMarkDone(topic)} 
                            className="flex-1"
                        >
                            Mark Done
                        </Button>
                    )}
                    {topic.type === 'revision' && isMissed && (
                        <Button variant="danger" onClick={() => onShift(topic.id, currentRevision.targetDate)} className="flex-1">
                            Shift 1D
                        </Button>
                    )}
                    <Button variant="info" onClick={() => onEdit(topic)} className="flex-1">
                        Edit
                    </Button>
                    <Button variant="secondary" onClick={() => onDelete(topic.id)} className={`w-1/3`}>
                        <Trash2 className="w-4 h-4 mx-auto" />
                    </Button>
                </div>
            </div>
        );
    };

    const RevisionSection = ({handleMarkDoneClick, handleShift, handleDeleteClick, handleOpenEditModal}) => {
        const revisionTopics = getRevisionTopics;
        let list = revisionTopics;

        const currentSubjects = subjects.filter(s => s.type === 'revision');

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
                <div className="grid md:grid-cols-2 gap-6">
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
                        <div className="col-span-2 bg-white p-8 rounded-xl shadow-lg text-center text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                            <h3 className="text-2xl font-semibold mb-2 dark:text-gray-200">No Revision Topics Here</h3>
                            <p>Add a new item or clear your filter.</p>
                        </div>
                    )}
                </div>
            );
        }

        return (
            <>
                <div className="bg-white p-4 rounded-xl shadow-lg mb-6 dark:bg-gray-800">
                    <h3 className="text-lg font-semibold text-gray-700 mb-3 dark:text-gray-300">Filter Subjects:</h3>
                    <div className="flex flex-wrap gap-2">
                        <Button
                            variant={selectedSubjectFilter === 'all' ? 'primary' : 'secondary'}
                            onClick={() => setSelectedSubjectFilter('all')}
                            className="text-sm px-3 py-1.5"
                        >
                            All
                        </Button>
                        {currentSubjects.map(subject => (
                            <Button
                                key={subject.id}
                                variant={selectedSubjectFilter === subject.id ? 'info' : 'secondary'}
                                onClick={() => setSelectedSubjectFilter(subject.id)}
                                className="text-sm px-3 py-1.5"
                            >
                                {subject.name}
                            </Button>
                        ))}
                        {selectedSubjectFilter !== 'all' && (
                            <Button
                                variant="secondary"
                                onClick={() => setSelectedSubjectFilter('all')}
                                className="text-sm px-3 py-1.5 text-red-600 hover:bg-red-100 bg-red-50 border border-red-200 dark:text-red-400 dark:hover:bg-red-900/30 dark:bg-red-900/20 dark:border-red-800"
                            >
                                Clear Filter
                            </Button>
                        )}
                    </div>
                </div>
                <div className="mt-4 flex justify-center mb-6">
                    <Button 
                        variant="outline" 
                        onClick={() => setIsManageRevisionSubjectsOpen(true)} 
                        className="text-sm px-4"
                    >
                        <Edit className="w-4 h-4 mr-2" /> Manage Revision Subjects
                    </Button>
                </div>

                <div className="flex border-b border-gray-200 mb-6 sticky top-[170px] sm:top-[80px] bg-gray-50 z-10 dark:bg-gray-700 dark:border-gray-600">
                    <button onClick={() => setActiveRevisionTab('dashboard')} className={tabClasses('dashboard', activeRevisionTab)}>
                        <LayoutDashboard className="w-4 h-4 mx-auto mb-1" /> Dashboard
                    </button>
                    <button onClick={() => setActiveRevisionTab('pending')} className={tabClasses('pending', activeRevisionTab)}>
                        <Clock className="w-4 h-4 mx-auto mb-1" /> Pending ({revisionTabCounts.pending})
                    </button>
                    <button onClick={() => setActiveRevisionTab('missed')} className={tabClasses('missed', activeRevisionTab)}>
                        <XCircle className="w-4 h-4 mx-auto mb-1" /> Missed ({revisionTabCounts.missed})
                    </button>
                    <button onClick={() => setActiveRevisionTab('done')} className={tabClasses('done', activeRevisionTab)}>
                        <CheckCircle className="w-4 h-4 mx-auto mb-1" /> Done ({revisionTabCounts.done})
                    </button>
                    <button onClick={() => setActiveRevisionTab('calendar')} className={tabClasses('calendar', activeRevisionTab)}>
                        <Calendar className="w-4 h-4 mx-auto mb-1" /> Calendar
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

        // Fixed calculations: strictly due today and this week
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
                        className="text-gray-200 dark:text-gray-600"
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
                        className="transition-all duration-500 text-green-500"
                    />
                    <text
                        x={size / 2}
                        y={size / 2}
                        textAnchor="middle"
                        dy=".3em"
                        className="text-xl font-bold fill-current text-gray-800 dark:text-gray-200"
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
                            <div key={group.date} className="bg-white p-5 rounded-xl shadow-lg border-l-4 border-green-500 dark:bg-gray-800 dark:border-green-700">
                                <h4 className="text-xl font-bold text-green-700 mb-3 border-b pb-2 dark:text-green-300 dark:border-green-600">Completed: {group.date}</h4>
                                <div className="space-y-3">
                                    {group.tasks.map(task => (
                                        <div key={task.id} className="p-3 bg-green-50 rounded-lg flex justify-between items-center border border-green-200 dark:bg-green-900/20 dark:border-green-800">
                                            <p className="font-medium text-gray-800 dark:text-gray-200">{task.name}</p>
                                            <span className="text-sm text-gray-600 bg-gray-100 px-2 py-0.5 rounded-full dark:text-gray-400 dark:bg-gray-700">
                                                {task.subjectName}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))
                    ) : (
                         <div className="col-span-2 bg-white p-8 rounded-xl shadow-lg text-center text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                            <h3 className="text-2xl font-semibold mb-2 dark:text-gray-200">No Completed Tasks</h3>
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
                    return <h3 className="text-xl font-bold text-gray-800 mb-4 dark:text-gray-200">{fallbackText}</h3>
                }
                if (activeTaskTab === 'today') {
                    return <h3 className="text-xl font-bold text-gray-800 mb-4 dark:text-gray-200">Today's Tasks & Overdue</h3>;
                }
                if (activeTaskTab === 'tomorrow') {
                    return <h3 className="text-xl font-bold text-gray-800 mb-4 dark:text-gray-200">Tomorrow's Tasks</h3>;
                }
                return <h3 className="text-xl font-bold text-gray-800 mb-4 dark:text-gray-200">{fallbackText}</h3>;
            };

            content = (
                <>
                    <SectionTitle 
                        fallbackText={activeTaskTab === 'upcoming' ? "Upcoming Tasks (After Tomorrow)" : "Recommended Tasks (No Date)"}
                    />
                    <div className="grid md:grid-cols-2 gap-6">
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
                            <div className="col-span-2 bg-white p-8 rounded-xl shadow-lg text-center text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                                <h3 className="text-2xl font-semibold mb-2 dark:text-gray-200">No Tasks Found</h3>
                                <p>You are all caught up for this section!</p>
                            </div>
                        )}
                    </div>
                </>
            );
        }

        return (
            <>
                <div className="bg-white p-4 rounded-xl shadow-lg mb-6 border-b-4 border-blue-600 dark:bg-gray-800 dark:border-blue-500">
                    <div className="mb-4">
                        <h3 className="text-2xl font-bold text-gray-800 dark:text-gray-200">Study Task Summary</h3>
                        <p className="text-sm text-gray-500 mt-1 dark:text-gray-400">
                            Active: {taskTabCounts.totalActive} | Completed: {taskTabCounts.totalCompleted} | Total: {taskTabCounts.total}
                        </p>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                        <div className="p-4 bg-blue-50 rounded-lg border border-blue-200 flex items-center justify-between dark:bg-blue-900/20 dark:border-blue-800">
                            <div>
                                <p className="text-sm font-semibold text-blue-800 dark:text-blue-200">Today's Tasks</p>
                                <h4 className="text-3xl font-bold text-gray-800 mt-1 dark:text-gray-200">{todayTotal}</h4>
                                <p className="text-xs text-gray-600 mt-1 dark:text-gray-400">Total</p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">Done: {todayDone} | Left: {todayLeft}</p>
                            </div>
                            <CircularProgress percentage={todayCompletionRate} size={70} />
                        </div>
                         <div className="p-4 bg-purple-50 rounded-lg border border-purple-200 flex items-center justify-between dark:bg-purple-900/20 dark:border-purple-800">
                            <div>
                                <p className="text-sm font-semibold text-purple-800 dark:text-purple-200">This Week</p>
                                <h4 className="text-3xl font-bold text-gray-800 mt-1 dark:text-gray-200">{weeklyTotal}</h4>
                                <p className="text-xs text-gray-600 mt-1 dark:text-gray-400">Total</p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">Done: {weeklyDone} | Left: {weeklyLeft}</p>
                            </div>
                            <CircularProgress percentage={weeklyCompletionRate} size={70} />
                        </div>
                    </div>
                </div>

                 <div className="bg-white p-4 rounded-xl shadow-lg mb-6 dark:bg-gray-800">
                    <h3 className="text-lg font-semibold text-gray-700 mb-3 dark:text-gray-300">Filter Subjects:</h3>
                    <div className="flex flex-wrap gap-2">
                        <Button
                            variant={selectedSubjectFilter === 'all' ? 'primary' : 'secondary'}
                            onClick={() => setSelectedSubjectFilter('all')}
                            className="text-sm px-3 py-1.5"
                        >
                            All
                        </Button>
                        {currentSubjects.map(subject => (
                            <Button
                                key={subject.id}
                                variant={selectedSubjectFilter === subject.id ? 'info' : 'secondary'}
                                onClick={() => setSelectedSubjectFilter(subject.id)}
                                className="text-sm px-3 py-1.5"
                            >
                                {subject.name}
                            </Button>
                        ))}
                         {selectedSubjectFilter !== 'all' && (
                            <Button
                                variant="secondary"
                                onClick={() => setSelectedSubjectFilter('all')}
                                className="text-sm px-3 py-1.5 text-red-600 hover:bg-red-100 bg-red-50 border border-red-200 dark:text-red-400 dark:hover:bg-red-900/30 dark:bg-red-900/20 dark:border-red-800"
                            >
                                Clear Filter
                            </Button>
                        )}
                    </div>
                </div>
                <div className="mt-4 flex justify-center mb-6">
                    <Button 
                        variant="outline" 
                        onClick={() => setIsManageTaskSubjectsOpen(true)} 
                        className="text-sm px-4"
                    >
                        <Edit className="w-4 h-4 mr-2" /> Manage Task Subjects
                    </Button>
                </div>

                <div className="flex border-b border-gray-200 mb-6 sticky top-[170px] sm:top-[80px] bg-gray-50 z-10 dark:bg-gray-700 dark:border-gray-600">
                    <button onClick={() => setActiveTaskTab('today')} className={tabClasses('today', activeTaskTab)}>
                        <Clock className="w-4 h-4 mx-auto mb-1" /> Today/Overdue ({taskTabCounts.today})
                    </button>
                    <button onClick={() => setActiveTaskTab('tomorrow')} className={tabClasses('tomorrow', activeTaskTab)}>
                        <Calendar className="w-4 h-4 mx-auto mb-1" /> Tomorrow ({taskTabCounts.tomorrow})
                    </button>
                    <button onClick={() => setActiveTaskTab('upcoming')} className={tabClasses('upcoming', activeTaskTab)}>
                        <ChevronRight className="w-4 h-4 mx-auto mb-1" /> Upcoming ({taskTabCounts.upcoming})
                    </button>
                    <button onClick={() => setActiveTaskTab('recommended')} className={tabClasses('recommended', activeTaskTab)}>
                        <List className="w-4 h-4 mx-auto mb-1" /> Recommended ({taskTabCounts.recommended})
                    </button>
                     <button onClick={() => setActiveTaskTab('completed')} className={tabClasses('completed', activeTaskTab)}>
                        <CheckCircle className="w-4 h-4 mx-auto mb-1" /> Completed ({taskTabCounts.totalCompleted})
                    </button>
                    <button onClick={() => setActiveTaskTab('calendar')} className={tabClasses('calendar', activeTaskTab)}>
                        <Calendar className="w-4 h-4 mx-auto mb-1" /> Calendar
                    </button>
                </div>
                
                {content}
            </>
        );
    };
    
    const ReportsSection = () => {
        const revisionTopics = getRevisionTopics;
        const taskTopics = getTaskTopics;
        
        const totalItems = revisionTopics.length + taskTopics.length;
        const completedItems = revisionTopics.filter(t => t.isComplete).length + taskTopics.filter(t => t.isComplete).length;
        const completionRate = totalItems > 0 ? (completedItems / totalItems) * 100 : 0;
        
        const allRevisions = revisionTopics.flatMap(t => t.schedule.filter(s => !s.isLongTerm));
        const totalRevisionsScheduled = allRevisions.length;
        const revisionsCompleted = allRevisions.filter(s => s.completed).length;
        const revisionsCompletedOnTime = allRevisions.filter(s => s.completed && s.completedDate && s.completedDate <= s.targetDate).length;
        
        const onTimeRate = revisionsCompleted > 0 ? (revisionsCompletedOnTime / revisionsCompleted) * 100 : 0;

        const stageBreakdown = useMemo(() => {
            const stages = { 'Not Started': 0 };
            REVISION_SCHEDULE.forEach((_, index) => stages[`R${index + 1}`] = 0);
            stages['Complete'] = 0;
            
            revisionTopics.forEach(topic => {
                const completed = topic.completedCount;
                if (topic.isComplete) {
                    stages['Complete']++;
                } else if (completed === 0) {
                    stages['Not Started']++;
                } else {
                    stages[`R${completed}`]++;
                }
            });
            return stages;
        }, [revisionTopics]);

        const subjectPerformance = subjects.filter(s => s.type === 'revision').map(subject => {
            const subjectTopics = revisionTopics.filter(t => t.subjectId === subject.id);
            const scheduled = subjectTopics.flatMap(t => t.schedule.filter(s => !s.isLongTerm));
            const totalCompleted = scheduled.filter(s => s.completed).length;
            const completedOnTime = scheduled.filter(s => s.completed && s.completedDate && s.completedDate <= s.targetDate).length;
            
            const successRate = totalCompleted > 0 ? (completedOnTime / totalCompleted) * 100 : 0;
            return { name: subject.name, totalCompleted, completedOnTime, successRate };
        }).filter(s => s.totalCompleted > 0);

        const revisionDailyAnalysis = useMemo(() => {
            const analysis = [];
            const daysToTrack = 14;
            for (let i = daysToTrack - 1; i >= 0; i--) {
                const dateMs = TODAY_MS - (i * 24 * 60 * 60 * 1000);
                
                const scheduled = allRevisions.filter(s => s.targetDate === dateMs);
                const done = scheduled.filter(s => s.completed && s.completedDate && s.completedDate <= dateMs + (24 * 60 * 60 * 1000));
                
                const totalScheduled = scheduled.length;
                const totalDone = done.length;
                const totalSkipped = totalScheduled - totalDone;
                
                analysis.push({
                    date: new Date(dateMs).toLocaleDateString('en-US', { day: 'numeric', month: 'short' }),
                    totalScheduled,
                    totalDone,
                    totalSkipped,
                    completionRate: totalScheduled > 0 ? (totalDone / totalScheduled) * 100 : 0,
                });
            }
            return analysis;
        }, [allRevisions]);
        
        const revisionWeeklyAnalysis = useMemo(() => {
            const analysis = [];
            for (let i = 3; i >= 0; i--) {
                const weekStartMs = START_OF_WEEK_MS - (i * 7 * 24 * 60 * 60 * 1000);
                const weekEndMs = weekStartMs + (7 * 24 * 60 * 60 * 1000);
                
                const scheduled = allRevisions.filter(s => s.targetDate >= weekStartMs && s.targetDate < weekEndMs);
                const done = scheduled.filter(s => s.completed && s.completedDate && s.completedDate < weekEndMs);
                
                const totalScheduled = scheduled.length;
                const totalDone = done.length;
                const totalSkipped = totalScheduled - totalDone;

                analysis.push({
                    weekLabel: new Date(weekStartMs).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                    totalScheduled,
                    totalDone,
                    totalSkipped,
                    completionRate: totalScheduled > 0 ? (totalDone / totalScheduled) * 100 : 0,
                });
            }
            return analysis;
        }, [allRevisions]);
        
        const taskCompletionTrends = useMemo(() => {
            const trends = [];
            const daysToTrack = 14;
            for (let i = daysToTrack - 1; i >= 0; i--) {
                const date = TODAY_MS - (i * 24 * 60 * 60 * 1000);
                
                const dueTasks = taskTopics.filter(t => t.taskDueDate && t.taskDueDate === date);
                const completedTasks = dueTasks.filter(t => t.completedDate && t.completedDate >= date && t.completedDate < date + (24 * 60 * 60 * 1000));
                
                const totalDue = dueTasks.length;
                const completedCount = completedTasks.length;
                const completionRate = totalDue > 0 ? (completedCount / totalDue) * 100 : 0;
                
                trends.push({
                    date: new Date(date).toLocaleDateString('en-US', { day: 'numeric', month: 'short' }),
                    completionRate: Math.round(completionRate),
                    completedCount,
                    totalDue
                });
            }
            return trends;
        }, [taskTopics]);

        const maxStageCount = Math.max(...Object.values(stageBreakdown), 1);

        return (
            <div className="space-y-8">
                <h2 className="text-3xl font-bold text-gray-800 flex items-center mb-6 dark:text-gray-200">
                    <BarChart3 className="w-6 h-6 mr-3" /> Performance Analytics
                </h2>

                <div className="grid md:grid-cols-3 gap-4">
                    <div className="bg-white p-6 rounded-xl shadow-lg border-l-4 border-blue-600 dark:bg-gray-800 dark:border-blue-500">
                        <p className="text-sm text-gray-500 dark:text-gray-400">Overall Items</p>
                        <h3 className="text-3xl font-bold text-gray-800 dark:text-gray-200">{totalItems}</h3>
                        <p className="text-sm text-green-600 font-semibold dark:text-green-400">{Math.round(completionRate)}% Completed</p>
                    </div>
                    <div className="bg-white p-6 rounded-xl shadow-lg border-l-4 border-green-600 dark:bg-gray-800 dark:border-green-500">
                        <p className="text-sm text-gray-500 dark:text-gray-400">Revision On-Time Rate</p>
                        <h3 className="text-3xl font-bold text-gray-800 dark:text-gray-200">{Math.round(onTimeRate)}%</h3>
                        <p className="text-sm text-gray-600 font-semibold dark:text-gray-300">{revisionsCompletedOnTime} of {revisionsCompleted} revisions done on time</p>
                    </div>
                    <div className="bg-white p-6 rounded-xl shadow-lg border-l-4 border-yellow-600 dark:bg-gray-800 dark:border-yellow-500">
                        <p className="text-sm text-gray-500 dark:text-gray-400">Tasks Active / Complete</p>
                        <h3 className="text-3xl font-bold text-gray-800 dark:text-gray-200">{taskTabCounts.totalActive} / {taskTabCounts.totalCompleted}</h3>
                        <p className="text-sm text-gray-600 font-semibold dark:text-gray-300">Total active tasks in Todo list.</p>
                    </div>
                </div>
                
                <div className="bg-white p-6 rounded-xl shadow-lg dark:bg-gray-800">
                    <h3 className="text-xl font-bold text-gray-800 mb-4 dark:text-gray-200">Revision Stage Breakdown</h3>
                    <div className="flex justify-between items-end h-64 space-x-2 border-b border-l border-gray-300 pb-2 pl-2 dark:border-gray-600">
                        {Object.entries(stageBreakdown).map(([stage, count]) => {
                            const heightPercent = maxStageCount > 0 ? (count / maxStageCount) * 100 : 0;
                            return (
                                <div key={stage} className="flex flex-col items-center flex-1 h-full justify-end relative group">
                                    <div 
                                        style={{ height: `${heightPercent}%` }} 
                                        className={`w-full max-w-[60px] rounded-t-lg transition-all duration-700 relative flex items-start justify-center pt-2 ${stage === 'Complete' ? 'bg-green-500' : stage === 'Not Started' ? 'bg-red-500' : 'bg-blue-500'}`}
                                    >
                                        <span className="text-xs font-bold text-white">{count}</span>
                                    </div>
                                    <span className="text-xs text-gray-600 mt-2 font-semibold text-center dark:text-gray-400">{stage}</span>
                                </div>
                            );
                        })}
                    </div>
                    <p className="text-center text-sm text-gray-600 mt-4 dark:text-gray-400">Distribution of {revisionTopics.length} topics by current revision stage.</p>
                </div>

                <div className="bg-white p-6 rounded-xl shadow-lg dark:bg-gray-800">
                    <h3 className="text-xl font-bold text-gray-800 mb-4 dark:text-gray-200">Revision Completion: Last 14 Days (Daily)</h3>
                    <div className="flex justify-between items-end h-64 space-x-1 border-b border-l border-gray-300 pb-2 pl-2 dark:border-gray-600">
                        {revisionDailyAnalysis.map((trend, index) => {
                            const maxHeight = Math.max(...revisionDailyAnalysis.map(t => t.totalScheduled), 1);
                            const doneHeight = (trend.totalDone / maxHeight) * 100;
                            const skippedHeight = (trend.totalSkipped / maxHeight) * 100;
                            
                            return (
                                <div key={index} className="flex flex-col items-center flex-1 h-full justify-end relative group">
                                    <div className="w-full flex flex-col justify-end items-center" style={{ height: '100%' }}>
                                        <div 
                                            style={{ height: `${skippedHeight}%` }} 
                                            className="w-full bg-red-400 flex items-start justify-center pt-1"
                                        >
                                            {trend.totalSkipped > 0 && <span className="text-xs font-bold text-white opacity-0 group-hover:opacity-100">{trend.totalSkipped}</span>}
                                        </div>
                                        <div 
                                            style={{ height: `${doneHeight}%` }} 
                                            className="w-full bg-green-500 transition-all duration-700 relative flex items-start justify-center pt-1"
                                        >
                                            {trend.totalDone > 0 && <span className="text-xs font-bold text-white opacity-0 group-hover:opacity-100">{trend.totalDone}</span>}
                                        </div>
                                    </div>
                                    <span className="text-xs text-gray-500 mt-2 dark:text-gray-400">{trend.date}</span>
                                </div>
                            );
                        })}
                    </div>
                    <p className="text-center text-sm text-gray-600 mt-4 dark:text-gray-400">Daily completion rate. (Red = Skipped/Pending, Green = Done)</p>
                </div>
                
                <div className="bg-white p-6 rounded-xl shadow-lg dark:bg-gray-800">
                    <h3 className="text-xl font-bold text-gray-800 mb-4 dark:text-gray-200">Revision Completion: Last 4 Weeks (Weekly)</h3>
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                            <thead className="bg-gray-50 dark:bg-gray-700">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Week Starting</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Scheduled</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Done</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Skipped/Pending</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Rate</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200 dark:bg-gray-800 dark:divide-gray-700">
                                {revisionWeeklyAnalysis.map((trend, index) => (
                                    <tr key={index}>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-200">{trend.weekLabel}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{trend.totalScheduled}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-green-600 font-semibold dark:text-green-400">{trend.totalDone}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-red-600 font-semibold dark:text-red-400">{trend.totalSkipped}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-blue-600 dark:text-blue-400">{Math.round(trend.completionRate)}%</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div className="bg-white p-6 rounded-xl shadow-lg dark:bg-gray-800">
                    <h3 className="text-xl font-bold text-gray-800 mb-4 dark:text-gray-200">Daily Task Completion Trends (Last 14 Days)</h3>
                    <div className="flex justify-between items-end h-64 space-x-1 border-b border-l border-gray-300 pb-2 pl-2 dark:border-gray-600">
                        {taskCompletionTrends.map((trend, index) => {
                            const heightPercent = trend.completionRate;
                            return (
                                <div key={index} className="flex flex-col items-center flex-1 h-full justify-end relative group">
                                    <div 
                                        style={{ height: `${heightPercent}%` }} 
                                        className="w-full bg-blue-500 rounded-t-lg transition-all duration-700 relative flex items-start justify-center pt-2"
                                    >
                                        <span className="text-xs font-bold text-white opacity-0 group-hover:opacity-100">{trend.completionRate}%</span>
                                    </div>
                                    <span className="text-xs text-green-600 mt-2 font-semibold dark:text-green-400">{trend.completedCount}/{trend.totalDue}</span>
                                    <span className={`text-xs text-gray-500 mt-1 ${index % 3 === 0 ? '' : 'hidden sm:inline'} dark:text-gray-400`}>{trend.date}</span>
                                </div>
                            );
                        })}
                    </div>
                    <p className="text-center text-sm text-gray-600 mt-4 dark:text-gray-400">Bar height = Completion Rate of tasks due on that day.</p>
                </div>

                <div className="bg-white p-6 rounded-xl shadow-lg dark:bg-gray-800">
                    <h3 className="text-xl font-bold text-gray-800 mb-4 dark:text-gray-200">Subject On-Time Success Rate (Revisions)</h3>
                    {subjectPerformance.length > 0 ? (
                        <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                                <thead className="bg-gray-50 dark:bg-gray-700">
                                    <tr>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Subject</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Completed On Time</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Total Completed</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">On-Time Rate</th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-200 dark:bg-gray-800 dark:divide-gray-700">
                                    {subjectPerformance.map(subject => (
                                        <tr key={subject.name}>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-200">{subject.name}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{subject.completedOnTime}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{subject.totalCompleted}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-green-600 dark:text-green-400">{Math.round(subject.successRate)}%</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <p className="text-gray-500 dark:text-gray-400">No past revision data available to generate subject analysis.</p>
                    )}
                </div>

            </div>
        );
    };

    const toggleDarkMode = useCallback(() => {
        const newMode = !darkMode;
        setDarkMode(newMode);
        if (typeof window !== 'undefined') {
            localStorage.setItem('darkMode', newMode);
        }
    }, [darkMode]);

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col dark:bg-gray-900">
            <header className="bg-white shadow-md p-4 sticky top-0 z-20 dark:bg-gray-800">
                <div className="max-w-6xl mx-auto flex flex-col gap-2">
                    <div className="flex justify-between items-center w-full">
                        <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-800 dark:text-gray-200">
                            Welcome, {userName}!
                        </h1>
                        <div className="flex space-x-2 sm:space-x-3 items-center flex-shrink-0">
                            <Button 
                                variant="outline"
                                onClick={toggleDarkMode}
                                className="flex items-center text-xs sm:text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-300"
                            >
                                {darkMode ? <Sun className="w-4 h-4 mr-1"/> : <Moon className="w-4 h-4 mr-1"/>} {darkMode ? 'Light' : 'Dark'}
                            </Button>
                            <Button 
                                variant="outline"
                                onClick={() => setIsProfileModalOpen(true)}
                                className="flex items-center text-xs sm:text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-300"
                            >
                                <User className="w-4 h-4 mr-1"/> Profile
                            </Button>
                            <Button 
                                variant="outline"
                                onClick={() => setIsTimerModalOpen(true)}
                                className="flex items-center text-xs sm:text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-300"
                            >
                                <Timer className="w-4 h-4 mr-1"/> Timer
                            </Button>
                            <Button
                                variant="secondary"
                                onClick={() => signOut(auth)}
                                className="bg-red-100 hover:bg-red-200 text-red-700 px-3 py-1.5 text-xs sm:text-sm dark:bg-red-900 dark:hover:bg-red-800 dark:text-red-300"
                            >
                                Logout
                            </Button>
                        </div>
                    </div>

                    <div className="flex space-x-2 pt-2 border-t border-gray-100 mt-2 sm:mt-0 sm:border-t-0 sm:pt-0 dark:border-gray-700">
                        <Button
                            variant={activeSection === 'revision' ? 'primary' : 'outline'}
                            onClick={() => setActiveSection('revision')}
                            className="flex-1 min-w-[150px] text-base"
                        >
                            Spaced Revision
                        </Button>
                        <Button
                            variant={activeSection === 'tasks' ? 'primary' : 'outline'}
                            onClick={() => setActiveSection('tasks')}
                            className="flex-1 min-w-[150px] text-base"
                        >
                            Study Tasks (Todo)
                        </Button>
                        <Button
                            variant={activeSection === 'reports' ? 'primary' : 'outline'}
                            onClick={() => setActiveSection('reports')}
                            className="flex-1 min-w-[150px] text-base"
                        >
                            Reports
                        </Button>
                    </div>

                    <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100 mt-2 sm:mt-0 sm:border-t-0 sm:pt-0 dark:border-gray-700">
                        <Button
                            variant="primary"
                            onClick={() => setIsAddTopicModalOpen(true)}
                            className="flex-1 min-w-[120px]"
                        >
                            <Plus className="w-4 h-4 mr-1" /> Add Item
                        </Button>
                        <Button
                            variant="secondary"
                            onClick={() => setIsAddSubjectModalOpen(true)}
                            className="flex-1 min-w-[120px] bg-purple-100 hover:bg-purple-200 text-purple-700 dark:bg-purple-900 dark:hover:bg-purple-800 dark:text-purple-300"
                        >
                            <BookOpen className="w-4 h-4 mr-1" /> Add Subject
                        </Button>
                        <Button
                            variant="secondary"
                            onClick={() => setIsRecycleBinOpen(true)}
                            className="flex-1 min-w-[120px] bg-gray-100 hover:bg-gray-200 text-gray-700 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-300"
                        >
                            <Trash2 className="w-4 h-4 mr-1" /> Bin ({deletedTopics.filter(t => !t.isPermanentDelete).length})
                        </Button>
                    </div>
                </div>
            </header>

            <main className="flex-1 max-w-6xl mx-auto w-full p-4 sm:p-6">
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
                    :
                    <ReportsSection />
                }
            </main>

            <AddTopicForm
                userId={userId}
                subjects={subjects.filter(s => s.type === (activeSection === 'revision' ? 'revision' : 'task'))}
                isOpen={isAddTopicModalOpen}
                onClose={() => setIsAddTopicModalOpen(false)}
                onAddTopic={handleAddTopic}
                defaultType={activeSection === 'revision' ? 'revision' : 'task'}
            />
            
            <Modal isOpen={isAddSubjectModalOpen} onClose={() => setIsAddSubjectModalOpen(false)} title={`Add New Subject (${activeSection === 'revision' ? 'Revision' : 'Task'})`}>
                <AddSubjectForm 
                    userId={userId} 
                    onClose={() => setIsAddSubjectModalOpen(false)} 
                    subjectCollectionGetter={activeSection === 'revision' ? getRevisionSubjectsCollection : getTaskSubjectsCollection}
                />
            </Modal>
            
            {topicToEdit && (
                <EditTopicModal
                    userId={userId}
                    topic={topicToEdit}
                    subjects={subjects.filter(s => s.type === topicToEdit.type)}
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
                title="Manage Revision Subjects"
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
            <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
                <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-blue-500"></div>
                <p className="ml-4 text-xl text-gray-700 font-semibold dark:text-gray-300">Checking session...</p>
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
