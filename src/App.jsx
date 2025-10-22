// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged } from "firebase/auth";
import { getFirestore, doc, collection, onSnapshot, setDoc, query, updateDoc, deleteDoc, writeBatch } from "firebase/firestore";
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'; 
import { Clock, CheckCircle, XCircle, Plus, LayoutDashboard, Calendar, Users, List, Trash2, ArrowCounterClockwise, Timer } from 'lucide-react';

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
            delay *= 2; // Exponential increase
        }
    }
};

// --- Firestore Helpers ---

const getTopicsCollection = (userId) => collection(db, `artifacts/spaced-revision/users/${userId}/revision_topics`);
const getSubjectsCollection = (userId) => collection(db, `artifacts/spaced-revision/users/${userId}/subjects`);

// --- Date Utilities ---

const TODAY_MS = (() => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date.getTime();
})();

const today = () => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date;
};

const dateToString = (date) => {
    if (!date) return 'N/A';
    const d = date.toDate ? date.toDate() : new Date(date);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const dateToISOString = (date) => {
    const d = date.toDate ? date.toDate() : new Date(date);
    return d.toISOString().split('T')[0];
};

// --- Revision Logic ---

const REVISION_SCHEDULE = [1, 3, 7, 15, 30]; // Days after initial study date
const LONG_TERM_REVIEW_INTERVAL = 45; // Days for post-completion review

// Generates the full schedule relative to the initial study date
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

    // Add a placeholder for long-term review if enabled
    if (enableLongTermReview) {
        schedule.push({
            targetDate: Infinity, // Placeholder for next long-term date
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

// --- Components ---

const Button = ({ children, onClick, className = '', disabled = false, variant = 'primary', type = 'button' }) => {
    let baseStyle = 'shadow-md font-semibold transition-all duration-200 focus:outline-none rounded-lg ';
    let colorStyle = '';

    switch (variant) {
        case 'primary':
            colorStyle = 'bg-blue-600 hover:bg-blue-700 text-white';
            break;
        case 'secondary':
            colorStyle = 'bg-gray-200 hover:bg-gray-300 text-gray-800';
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
            colorStyle = 'border border-gray-300 hover:bg-gray-100 text-gray-700 shadow-none';
            break;
        case 'disabled':
            colorStyle = 'bg-gray-300 text-gray-500 cursor-not-allowed shadow-none';
            break;
        default:
            colorStyle = 'bg-blue-600 hover:bg-blue-700 text-white';
            break;
    }

    if (disabled) {
        colorStyle = 'bg-gray-300 text-gray-500 cursor-not-allowed shadow-none';
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

// --- Modals ---

const Modal = ({ isOpen, onClose, title, children, size = 'sm:max-w-lg' }) => {
    if (!isOpen) return null;

    return (
        // FIX: Increased z-index to ensure it covers the sticky header/navbar (z-10)
        <div className="fixed inset-0 z-[90] overflow-y-auto" style={{ backgroundColor: 'rgba(0,0,0,0.75)' }}>
            <div className="flex items-center justify-center min-h-screen p-4">
                <div className={`bg-white rounded-xl shadow-2xl w-full max-w-sm ${size} transform transition-all`}>
                    <div className="px-6 py-4 border-b flex justify-between items-center">
                        <h3 className="text-xl font-bold text-gray-800">{title}</h3>
                        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors" type="button">
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
            <p className="text-gray-700 mb-6">{message}</p>
            <div className="flex justify-end space-x-3">
                <Button variant="secondary" onClick={onClose}>Cancel</Button>
                <Button variant="danger" onClick={() => { onConfirm(); onClose(); }}>{confirmText}</Button>
            </div>
        </Modal>
    );
};

// --- Subtopic List Component ---

const SubtopicInputList = ({ subtopics, setSubtopics, disabled }) => {
    const nextSubtopicId = useRef(0);

    useEffect(() => {
        // Find the highest ID among existing subtopics or start from a high number
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
        <div className="space-y-3 p-4 bg-gray-50 rounded-lg border">
            <h4 className="text-base font-semibold text-gray-700">Subtopics / Problems (Optional)</h4>
            
            <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
                {subtopics.map((sub) => (
                    <div key={sub.id} className="flex items-center space-x-2 bg-white p-2 border rounded-lg shadow-sm">
                        <input
                            type="text"
                            value={sub.name}
                            onChange={(e) => updateSubtopic(sub.id, 'name', e.target.value)}
                            placeholder="Subtopic Name / Problem Title"
                            className="flex-3 p-2 border border-gray-200 rounded-lg text-sm w-full"
                            disabled={disabled}
                        />
                        <input
                            type="text"
                            value={sub.number}
                            onChange={(e) => updateSubtopic(sub.id, 'number', e.target.value)}
                            placeholder="No."
                            className="flex-1 w-1/4 p-2 border border-gray-200 rounded-lg text-sm text-center"
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
                className="w-full justify-center text-blue-600 bg-blue-100 hover:bg-blue-200 disabled:opacity-50"
                disabled={disabled}
            >
                <Plus className="h-4 w-4 mr-1" /> Add Problem/Subtopic
            </Button>
        </div>
    );
};

// --- Timer Component ---

const TimerModal = ({ isOpen, onClose }) => {
    const [time, setTime] = useState(() => {
        const storedTime = localStorage.getItem('activeTimerTime');
        return storedTime ? parseInt(storedTime, 10) : 0;
    });
    const [isRunning, setIsRunning] = useState(false);

    useEffect(() => {
        let interval = null;
        if (isRunning) {
            interval = setInterval(() => {
                setTime(prevTime => {
                    const newTime = prevTime + 1000;
                    localStorage.setItem('activeTimerTime', newTime.toString());
                    return newTime;
                });
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
        localStorage.removeItem('activeTimerTime');
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Problem Solving Timer" size="sm:max-w-md">
            <div className="flex flex-col items-center space-y-6">
                <div className="text-6xl sm:text-7xl font-mono font-bold text-gray-800 bg-gray-100 p-6 rounded-xl shadow-inner w-full text-center">
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
                <p className="text-sm text-gray-500">Timer state persists across browser reloads.</p>
            </div>
        </Modal>
    );
};

// --- Recycle Bin Modal ---

const RecycleBinModal = ({ userId, deletedTopics, isOpen, onClose, onRecover, onEmptyBin }) => {
    const activeDeletedTopics = deletedTopics.filter(t => !t.isPermanentDelete);

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Recycle Bin" size="sm:max-w-2xl">
            <p className="text-sm text-gray-600 mb-4">
                Items are permanently deleted 60 days after being moved here.
            </p>
            <div className="flex justify-between items-center mb-4 border-b pb-2">
                <span className="font-semibold text-gray-700">Total Items: {activeDeletedTopics.length}</span>
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
                    <div className="text-center p-8 bg-gray-100 rounded-lg">
                        <Trash2 className="w-8 h-8 mx-auto text-gray-400 mb-2"/>
                        <p className="text-gray-600">Recycle Bin is empty.</p>
                    </div>
                ) : (
                    activeDeletedTopics.map(topic => (
                        <div key={topic.id} className="p-4 bg-white rounded-lg border border-gray-200 flex justify-between items-center shadow-sm">
                            <div>
                                <p className="font-semibold text-gray-800">{topic.name}</p>
                                <p className="text-xs text-gray-500">Deleted: {dateToString(topic.deletedAt)}</p>
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

// --- Forms and Logic (Add/Edit) ---

const AddTopicForm = ({ userId, subjects, isOpen, onClose, onAddTopic }) => {
    const [type, setType] = useState('revision'); // 'revision' or 'task'
    const [topicName, setTopicName] = useState('');
    const [initialDate, setInitialDate] = useState(dateToISOString(TODAY_MS));
    const [taskDueDate, setTaskDueDate] = useState(dateToISOString(TODAY_MS));
    const [selectedSubjectId, setSelectedSubjectId] = useState('');
    const [subtopics, setSubtopics] = useState([]); 
    const [enableLtr, setEnableLtr] = useState(false); // Long-Term Review
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
        
        try {
            await onAddTopic({
                type,
                name: topicName.trim(),
                subjectId: selectedSubjectId,
                initialStudyDate: studyDate.getTime(),
                taskDueDate: type === 'task' && taskDueDate ? new Date(taskDueDate).getTime() : null,
                subtopics: cleanedSubtopics,
                enableLtr: type === 'revision' ? enableLtr : false
            });
            
            // Reset state
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

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Add New Study Item">
            <form onSubmit={handleSubmit}>
                {/* Type Selection */}
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
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 mb-4"
                    disabled={loading}
                />
                
                <div className="flex flex-col sm:flex-row sm:space-x-4 space-y-4 sm:space-y-0 mb-4">
                    <select
                        value={selectedSubjectId}
                        onChange={(e) => setSelectedSubjectId(e.target.value)}
                        required
                        className="flex-1 w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
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
                            title="Original Study Date (Used to calculate schedule)"
                            className="w-full sm:w-1/2 p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                            disabled={loading}
                        />
                    ) : (
                         <input
                            type="date"
                            value={taskDueDate}
                            onChange={(e) => setTaskDueDate(e.target.value)}
                            title="Optional Due Date for this task"
                            className="w-full sm:w-1/2 p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                            disabled={loading}
                        />
                    )}
                </div>

                {/* Subtopic Input List is available for both types */}
                <SubtopicInputList subtopics={subtopics} setSubtopics={setSubtopics} disabled={loading} />

                {isRevision && (
                    <div className="mt-4 flex items-center space-x-2 bg-purple-50 p-3 rounded-lg border border-purple-200">
                        <input 
                            type="checkbox" 
                            id="enableLtr" 
                            checked={enableLtr} 
                            onChange={(e) => setEnableLtr(e.target.checked)}
                            className="w-4 h-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500"
                        />
                        <label htmlFor="enableLtr" className="text-sm font-medium text-purple-800">
                            Enable **Long-Term Review** (45 Days after final revision)
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

// --- Forms and Logic (Add/Edit) ---

const EditTopicModal = ({ userId, topic, subjects, isOpen, onClose, onSave }) => {
    const initialStudyDateString = topic ? dateToISOString(topic.initialStudyDate) : dateToISOString(TODAY_MS);
    
    const [topicName, setTopicName] = useState(topic?.name || '');
    const [initialDate, setInitialDate] = useState(initialStudyDateString);
    const [taskDueDate, setTaskDueDate] = useState(topic?.taskDueDate ? dateToISOString(topic.taskDueDate) : dateToISOString(TODAY_MS));
    const [selectedSubjectId, setSelectedSubjectId] = useState(topic?.subjectId || '');
    const [subtopics, setSubtopics] = useState(() => topic?.subtopics?.map(sub => ({...sub, id: sub.id || Math.random()})) || []); 
    const [enableLtr, setEnableLtr] = useState(topic?.enableLtr || false);
    const [loading, setLoading] = useState(false);
    const isRevision = topic?.type === 'revision';
    
    // Reset state when a new topic is loaded
    useEffect(() => {
        if (topic) {
            setTopicName(topic.name);
            setSelectedSubjectId(topic.subjectId);
            setInitialDate(isRevision ? dateToISOString(topic.initialStudyDate) : dateToISOString(TODAY_MS));
            setTaskDueDate(topic.taskDueDate ? dateToISOString(topic.taskDueDate) : dateToISOString(TODAY_MS));
            setEnableLtr(topic.enableLtr || false);
            // Map subtopics to ensure they have unique, temporary IDs for stable React rendering during editing
            setSubtopics(topic.subtopics?.map(sub => ({...sub, id: sub.id || Math.random()})) || []);
        }
    }, [topic]);


    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!topicName.trim() || !selectedSubjectId || !userId || !topic) return;

        setLoading(true);
        
        // Clean up subtopics: remove empty entries and map to simpler structure
        const cleanedSubtopics = subtopics
            .filter(sub => sub.name.trim() !== '')
            .map(sub => ({ name: sub.name.trim(), number: sub.number.trim() }));
        
        try {
            await onSave(topic.id, topicName.trim(), selectedSubjectId, initialDate, cleanedSubtopics, enableLtr);
            onClose();
        } catch (error) {
            console.error('Error saving edited topic:', error);
            console.error('Failed to update topic. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`Edit ${topic?.type === 'revision' ? 'Topic' : 'Task'}: ${topic?.name || ''}`}>
            <form onSubmit={handleSubmit}>
                <input
                    type="text"
                    value={topicName}
                    onChange={(e) => setTopicName(e.target.value)}
                    placeholder="Topic Name"
                    required
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 mb-4"
                    disabled={loading}
                />
                <div className="flex flex-col sm:flex-row sm:space-x-4 space-y-4 sm:space-y-0 mb-4">
                    <select
                        value={selectedSubjectId}
                        onChange={(e) => setSelectedSubjectId(e.target.value)}
                        required
                        className="flex-1 w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
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
                            className="w-full sm:w-1/2 p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                            disabled={loading}
                        />
                    ) : (
                         <input
                            type="date"
                            value={taskDueDate}
                            onChange={(e) => setTaskDueDate(e.target.value)}
                            title="Due Date for this task"
                            className="w-full sm:w-1/2 p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                            disabled={loading}
                        />
                    )}
                </div>
                <p className='text-xs text-yellow-600 bg-yellow-50 p-2 rounded-lg mb-4'>
                    {isRevision 
                        ? `*Changing the Study Date will regenerate the entire revision schedule (revisions completed so far will be lost).` 
                        : `*Optional: Task Due Date is used for Pending reminders.`}
                </p>
                
                {/* Subtopic Input List */}
                <SubtopicInputList subtopics={subtopics} setSubtopics={setSubtopics} disabled={loading} />

                {isRevision && (
                    <div className="mt-4 flex items-center space-x-2 bg-purple-50 p-3 rounded-lg border border-purple-200">
                        <input 
                            type="checkbox" 
                            id="enableLtr-edit" 
                            checked={enableLtr} 
                            onChange={(e) => setEnableLtr(e.target.checked)}
                            className="w-4 h-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500"
                        />
                        <label htmlFor="enableLtr-edit" className="text-sm font-medium text-purple-800">
                            Enable **Long-Term Review** (45 Days after final revision)
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

const CalendarView = ({ topics, allSubjects }) => {
    const [currentDate, setCurrentDate] = useState(today());
    const [selectedDate, setSelectedDate] = useState(null);
    const [modalOpen, setModalOpen] = useState(false);

    const startOfMonth = useMemo(() => {
        const d = new Date(currentDate);
        d.setDate(1);
        return d;
    }, [currentDate]);

    const daysInMonth = useMemo(() => {
        const d = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
        return d.getDate();
    }, [currentDate]);

    const firstDayOfWeek = startOfMonth.getDay(); // 0 (Sun) to 6 (Sat)

    const revisionMap = useMemo(() => {
        const map = new Map();
        topics.forEach(topic => {
            // Check revision schedule
            topic.schedule?.forEach((scheduleItem, index) => {
                // Only consider uncompleted items (which are all we care about for planning)
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

            // Check task due dates
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
        return map;
    }, [topics, allSubjects]);

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
        setModalOpen(true);
    };

    const handleDayClick = (dayOfMonth) => {
        const date = new Date(currentDate.getFullYear(), currentDate.getMonth(), dayOfMonth);
        setSelectedDate(date);
        setModalOpen(true);
    };

    const todayISO = dateToISOString(today());
    const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    return (
        <div className="p-4 bg-white rounded-xl shadow-lg">
            <header className="flex justify-between items-center mb-6">
                <Button onClick={handlePrevMonth} variant="secondary">
                    <XCircle className="w-4 h-4" />
                </Button>
                <div className="text-xl font-bold text-gray-800 flex flex-col items-center">
                    {currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                    <Button onClick={handleToday} variant="secondary" className="mt-2 py-1 px-3 text-xs">Jump to Today</Button>
                </div>
                <Button onClick={handleNextMonth} variant="secondary">
                    <CheckCircle className="w-4 h-4" />
                </Button>
            </header>

            <div className="grid grid-cols-7 gap-1 text-center font-medium text-sm text-gray-500 mb-2">
                {daysOfWeek.map(day => (
                    <div key={day} className="py-2 text-blue-600 font-bold">{day}</div>
                ))}
            </div>

            <div className="grid grid-cols-7 gap-1">
                {/* Empty padding days for start of month */}
                {[...Array(firstDayOfWeek)].map((_, i) => (
                    <div key={`empty-${i}`} className="h-16"></div>
                ))}

                {/* Days of the month */}
                {[...Array(daysInMonth)].map((_, i) => {
                    const day = i + 1;
                    const date = new Date(currentDate.getFullYear(), currentDate.getMonth(), day);
                    const dateISO = dateToISOString(date);
                    const revisionsDue = revisionMap.get(dateISO);
                    const isToday = dateISO === todayISO;
                    const isSelected = selectedDate && dateISO === dateToISOString(selectedDate);
                    
                    const hasItems = revisionsDue && revisionsDue.length > 0;
                    
                    const cellClasses = `h-20 flex flex-col items-center justify-center p-1 rounded-lg transition-colors cursor-pointer 
                                         ${isToday ? 'bg-blue-100 border-2 border-blue-500' : 'bg-gray-50 hover:bg-gray-200'}
                                         ${isSelected ? 'bg-purple-200 border-purple-500' : ''}`;

                    return (
                        <div key={day} className={cellClasses} onClick={() => handleDayClick(day)}>
                            <span className={`font-semibold ${isToday ? 'text-blue-700' : 'text-gray-800'} text-lg`}>{day}</span>
                            {hasItems && (
                                <span className={`text-xs mt-1 px-2 py-0.5 rounded-full font-bold ${revisionsDue.some(r => r.isMissed) ? 'bg-red-500 text-white' : 'bg-green-500 text-white'}`}>
                                    {revisionsDue.length} Due
                                </span>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Revision Details Modal */}
            <Modal 
                isOpen={modalOpen} 
                onClose={() => setModalOpen(false)} 
                title={`Schedule for ${dateToString(selectedDate)}`}
                size="sm:max-w-xl"
            >
                {selectedDate && revisionMap.has(dateToISOString(selectedDate)) ? (
                    <div className="space-y-3 max-h-96 overflow-y-auto pr-2">
                        {revisionMap.get(dateToISOString(selectedDate)).map((revision, index) => (
                            <div 
                                key={index} 
                                className={`p-3 rounded-lg shadow-sm border-l-4 
                                    ${revision.isMissed ? 'bg-red-50 border-red-500' : revision.type === 'Task' ? 'bg-purple-50 border-purple-500' : 'bg-green-50 border-green-500'}`}
                            >
                                <p className="font-semibold text-gray-800">{revision.topicName}</p>
                                <div className="flex justify-between text-sm text-gray-600">
                                    <span>Subject: {revision.subjectName}</span>
                                    <span className="font-bold">
                                        {revision.isMissed ? '(MISSED)' : revision.type === 'Task' ? '(TASK DUE)' : '(REVISION DUE)'}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <p className="text-gray-500">Nothing scheduled for this date. Go enjoy the break!</p>
                )}
            </Modal>
        </div>
    );
};


// --- App Logic Component ---

const AppLogic = ({ userId, topics, subjects, allSubjects }) => {
    const [activeTab, setActiveTab] = useState('dashboard');
    const [isAddTopicModalOpen, setIsAddTopicModalOpen] = useState(false);
    const [isAddSubjectModalOpen, setIsAddSubjectModalOpen] = useState(false);
    const [isRecycleBinOpen, setIsRecycleBinOpen] = useState(false);
    const [topicToEdit, setTopicToEdit] = useState(null); 
    const [isEditTopicModalOpen, setIsEditTopicModalOpen] = useState(false); 
    const [isTimerModalOpen, setIsTimerModalOpen] = useState(false); // Timer Modal State

    const [confirmAction, setConfirmAction] = useState({
        isOpen: false,
        title: '',
        message: '',
        onConfirm: () => {},
        confirmText: 'Confirm'
    });

    const [selectedSubjectFilter, setSelectedSubjectFilter] = useState('all');

    // --- Data Manipulation Helpers (Moved to AppLogic for access to state) ---
    
    // Core logic for adding a new subject
    const AddSubjectForm = ({ userId, onClose }) => {
        const [name, setName] = useState('');
        const [loading, setLoading] = useState(false);
    
        const handleSubmit = async (e) => {
            e.preventDefault();
            if (!name.trim() || !userId) return;
    
            setLoading(true);
            try {
                const subjectDocRef = doc(getSubjectsCollection(userId));
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
                    placeholder="Subject Name (e.g., Organic Chemistry)"
                    required
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 mb-4"
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
    

    // CORE FUNCTION: Adds a new topic or task
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
            };

            await exponentialBackoff(() => setDoc(topicDocRef, topicData));
            setIsAddTopicModalOpen(false);
        } catch (error) {
            console.error('Error adding topic/task:', error);
        }
    }, [userId]);

    // CORE FUNCTION: Marks the revision/task as complete
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
                    // Mark Todo/Task as permanently done
                    batch.update(topicRef, { isComplete: true, completedDate: Date.now() });
                } else {
                    // Revision Topic Logic
                    const currentRevision = topic.nextRevision;

                    if (!currentRevision) {
                        console.error("Attempted to mark done without a next revision.");
                        return;
                    }

                    let updatedSchedule = topic.schedule.map(s => {
                        // Mark the current one as complete
                        if (s.targetDate === currentRevision.targetDate) {
                            return { ...s, completed: true, completedDate: Date.now() };
                        }
                        return s;
                    });
                    
                    const allRevisionsCompleted = updatedSchedule.filter(s => !s.isLongTerm).every(s => s.completed);

                    // Handle Long Term Review Recalculation
                    if (allRevisionsCompleted && topic.enableLtr) {
                        const ltrIndex = updatedSchedule.findIndex(s => s.isLongTerm);
                        const lastCompletedDate = Date.now();
                        const nextReviewDate = new Date(lastCompletedDate);
                        nextReviewDate.setDate(nextReviewDate.getDate() + LONG_TERM_REVIEW_INTERVAL);

                        if (ltrIndex !== -1) {
                            // Update existing LTR slot
                            updatedSchedule[ltrIndex] = {
                                ...updatedSchedule[ltrIndex],
                                targetDate: nextReviewDate.getTime(),
                                completed: false, // Reset for next cycle
                            };
                        } else {
                            // Should not happen if LTR was enabled initially, but safe guard
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
    
    // CORE FUNCTION: Shifts all uncompleted revision dates one day ahead.
    const handleShift = useCallback(async (topicId, missedTargetDate) => {
        if (!userId || !topicId) return; 
        const topicRef = doc(getTopicsCollection(userId), topicId);

        try {
            await exponentialBackoff(async () => {
                const batch = writeBatch(db);
                const topic = topics.find(t => t.id === topicId);
                if (!topic) return;

                const updatedSchedule = topic.schedule.map(s => {
                    // Only shift uncompleted revisions that are due on or after the target date
                    if (!s.completed && s.targetDate >= missedTargetDate) {
                        // Shift date by one day (86400000 ms)
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


    // CORE FUNCTION: Moves topic to recycle bin (soft delete)
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

    // CORE FUNCTION: Permanently deletes topic (from recycle bin)
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

    // CORE FUNCTION: Recovers topic from recycle bin
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


    // --- Handlers for Modals/Actions ---

    const handleOpenEditModal = useCallback((topic) => {
        setTopicToEdit(topic);
        setIsEditTopicModalOpen(true);
    }, []);

    const handleDeleteClick = useCallback((topicId) => {
        setConfirmAction({
            isOpen: true,
            title: 'Move to Recycle Bin',
            message: 'Are you sure you want to move this item to the Recycle Bin? You can recover it within 60 days.',
            onConfirm: () => handleSoftDelete(topicId),
            confirmText: 'Move to Bin'
        });
    }, [handleSoftDelete]);


    const handleMarkDoneClick = useCallback((topic) => {
        // Todo item: Mark as complete
        if (topic.type === 'task') {
             setConfirmAction({
                isOpen: true,
                title: 'Confirm Task Completion',
                message: `Mark "${topic.name}" as complete? It will be removed from your active lists.`,
                onConfirm: () => handleMarkDone(topic),
                confirmText: 'Mark Complete'
            });
        } else {
            // Revision item: Mark current step done
             setConfirmAction({
                isOpen: true,
                title: 'Confirm Revision',
                message: `Are you sure you want to mark "${topic.name}" as DONE for this revision?`,
                onConfirm: () => handleMarkDone(topic),
                confirmText: 'Mark Done'
            });
        }
    }, [handleMarkDone]);
    
    // Handle Editing Topic Details 
    const handleEditTopic = useCallback(async (topicId, name, subjectId, initialDateString, subtopics, enableLtr) => {
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
            enableLtr: existingTopic.type === 'revision' ? enableLtr : false,
        };

        // If initial study date has changed, or LTR state changed for a revision topic, recalculate schedule
        const dateChanged = newStudyDateMs !== originalStudyDateMs;
        const ltrChanged = existingTopic.enableLtr !== enableLtr;

        if (existingTopic.type === 'revision' && (dateChanged || ltrChanged)) {
            updateData.initialStudyDate = newStudyDateMs;
            // Generate a *new* full schedule based on the new start date and LTR setting
            updateData.schedule = generateSchedule(newStudyDate, enableLtr);
        }

        try {
            await exponentialBackoff(() => updateDoc(topicRef, updateData));
        } catch (error) {
            console.error('Error updating topic:', error);
            throw error; 
        }
    }, [userId, topics]);


    // --- Data Processing (Core Logic) ---

    const processedTopics = useMemo(() => {
        const todayMs = TODAY_MS;
        const tomorrowMs = TODAY_MS + (1000 * 60 * 60 * 24);

        return topics.filter(t => !t.deleted).map(topic => {
            // Defensive default for older topics lacking a 'type' field
            const type = topic.type || 'revision'; 
            
            const completedCount = topic.schedule?.filter(s => s.completed)?.length || 0;
            let nextRevision = topic.schedule?.find(s => !s.completed) || null;
            
            // --- Long Term Review Logic (Recalculate targetDate for fully revised topics) ---
            if (type === 'revision' && topic.enableLtr && completedCount === REVISION_SCHEDULE.length) {
                const ltrRevision = topic.schedule.find(s => s.isLongTerm);

                if (ltrRevision) {
                    let nextLtrDateMs = ltrRevision.targetDate;

                    // If LTR is due/missed, we don't recalculate unless marked done.
                    // If targetDate is Infinity (first time reaching completion), calculate it now.
                    if (nextLtrDateMs === Infinity) {
                         // Find the last actual completion date or use initial study date
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


            const isComplete = !nextRevision && type === 'revision';
            
            let isPending = false;
            let isMissed = false;
            let isTaskPending = false; 

            if (type === 'revision' && nextRevision) {
                isPending = nextRevision.targetDate <= todayMs;
                isMissed = nextRevision.targetDate < todayMs;
            } else if (type === 'task' && topic.taskDueDate && !topic.isComplete) {
                // Task is pending if due today or tomorrow
                isTaskPending = topic.taskDueDate <= tomorrowMs;
                isPending = isTaskPending; // Use task pending for general pending categorization
            }
            
            const isDone = completedCount > 0;

            return {
                ...topic,
                type, // Use the derived type
                completedCount,
                nextRevision,
                isComplete,
                isPending,
                isMissed,
                isDone,
                isTaskPending, // Specific flag for Todo items due soon
                subjectName: allSubjects[topic.subjectId]?.name || 'Unknown Subject',
            };
        });
    }, [topics, allSubjects]);

    const filteredTopics = useMemo(() => {
        let list = processedTopics;

        if (selectedSubjectFilter !== 'all') {
            list = list.filter(t => t.subjectId === selectedSubjectFilter);
        }

        switch (activeTab) {
            case 'pending':
                // Pending: Revision topics due today/future (but not missed), AND tasks due today/tomorrow
                list = list.filter(t => 
                    (t.type === 'revision' && t.isPending && !t.isMissed) || 
                    (t.type === 'task' && t.isTaskPending)
                );
                break;
            case 'missed':
                // Missed: ONLY Revision topics that are strictly overdue
                list = list.filter(t => t.type === 'revision' && t.isMissed);
                break;
            case 'done':
                // Done tab includes all revision topics that have completed at least one revision AND are not fully complete
                list = list.filter(t => t.type === 'revision' && t.isDone && !t.isComplete);
                break;
            case 'tasks':
                // Tasks: ONLY Todo items that are not yet complete
                list = list.filter(t => t.type === 'task' && !t.isComplete);
                break;
            case 'dashboard':
            default:
                // Dashboard shows all active topics (both revision and task)
                break;
        }

        // Default sorting: Missed > Due Today/Pending > Soonest Next Date/Due Date > Completed
        return list.sort((a, b) => {
             // 1. Missed/Overdue Revisions First
            if (a.isMissed !== b.isMissed) {
                return a.isMissed ? -1 : 1;
            }

            // 2. Pending Revisions/Tasks Due Soon (Today/Tomorrow)
            if (a.isPending !== b.isPending) {
                return a.isPending ? -1 : 1;
            }
            
            // 3. Sort by Next Date (Only for items with a date)
            const aDate = a.type === 'revision' ? a.nextRevision?.targetDate || Infinity : a.taskDueDate || Infinity;
            const bDate = b.type === 'revision' ? b.nextRevision?.targetDate || Infinity : b.taskDueDate || Infinity;
            return aDate - bDate;
        });
    }, [processedTopics, activeTab, selectedSubjectFilter]);

    const deletedTopics = useMemo(() => {
        // Filter out permanently deleted items (60 days old)
        const sixtyDaysAgo = Date.now() - (60 * 24 * 60 * 60 * 1000);
        
        return topics.filter(t => t.deleted).map(t => ({
            ...t,
            isPermanentDelete: t.deletedAt < sixtyDaysAgo
        }));

    }, [topics]);

    // --- Tab Counts ---
    const tabCounts = useMemo(() => ({
        pending: processedTopics.filter(t => (t.type === 'revision' && t.isPending && !t.isMissed) || (t.type === 'task' && t.isTaskPending)).length,
        missed: processedTopics.filter(t => t.type === 'revision' && t.isMissed).length,
        done: processedTopics.filter(t => t.type === 'revision' && t.isDone && !t.isComplete).length,
        tasks: processedTopics.filter(t => t.type === 'task' && !t.isComplete).length,
    }), [processedTopics]);

    const tabClasses = (tab) => (
        `flex-1 text-center py-2 font-semibold transition-colors rounded-t-lg text-xs sm:text-sm 
        ${activeTab === tab ? 'bg-white shadow-inner text-blue-600 border-b-2 border-blue-600' : 'text-gray-600 hover:text-blue-500'}`
    );

    // --- Timer Logic Component (Moved here for access to global state, though it relies on localStorage) ---
    const TimerLogic = () => {
        const [isModalOpen, setIsModalOpen] = useState(false);
        return (
            <>
                <Button 
                    variant="outline" 
                    onClick={() => setIsModalOpen(true)}
                    className="flex items-center text-xs sm:text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5"
                >
                    <Clock className="w-4 h-4 mr-1"/> Timer
                </Button>
                <TimerModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
            </>
        );
    };

    // --- User Info Helper Component ---
    const UserInfo = () => {
        const truncatedId = userId ? `${userId.substring(0, 4)}...${userId.substring(userId.length - 4)}` : 'N/A';
        return (
            <div className="flex items-center text-xs sm:text-sm text-gray-500 bg-gray-100 p-2 rounded-lg shadow-inner flex-shrink-0">
                <Users className="h-4 w-4 mr-1 text-blue-500" />
                <span className="hidden sm:inline font-semibold text-gray-700">User ID:</span>
                <code className="ml-1 text-blue-600 font-mono text-xs">{truncatedId}</code>
            </div>
        );
    };
    
    // --- Topic Card Component (Moved inside AppLogic) ---
    
    const TopicCard = ({ topic, subjectName, onMarkDone, onShift, onDelete, onEdit }) => {
        const totalRevisions = REVISION_SCHEDULE.length;
        const completedRevisions = topic.schedule?.filter(s => s.completed && !s.isLongTerm)?.length || 0;
        const currentRevision = topic.schedule?.find(s => !s.completed) || null;
        const isComplete = !currentRevision && topic.type === 'revision';
        
        const statusText = getStatusText(currentRevision, totalRevisions, topic.type);
        const isMissed = statusText.startsWith('Missed');
        const isDue = statusText.includes('Due Today');
        
        // Use taskDueDate for tasks, or nextRevisionDate for revision topics
        const nextDate = topic.type === 'task' 
            ? (topic.taskDueDate ? new Date(topic.taskDueDate) : null)
            : (currentRevision ? new Date(currentRevision.targetDate) : null);
        
        const initialStudyDate = topic.type === 'revision' ? dateToString(topic.initialStudyDate) : dateToString(topic.createdAt);
        
        const progressPercent = topic.type === 'revision' ? (completedRevisions / totalRevisions) * 100 : 0;
        const hasSubtopics = topic.subtopics && topic.subtopics.length > 0;

        let cardBorder = 'border-gray-200';
        let statusColor = 'text-gray-600';
        let typeBadge = '';
        
        // Revision Specific Styling
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
        } 
        // Task Specific Styling
        else if (topic.type === 'task') {
            typeBadge = 'Study Task';
            cardBorder = 'border-purple-400';
            if (topic.isTaskPending) {
                cardBorder = 'border-orange-500 ring-2 ring-orange-100';
                statusColor = 'text-orange-600';
            }
        }

        return (
            <div className={`bg-white border-l-4 ${cardBorder} rounded-xl shadow-lg p-5 flex flex-col space-y-3`}>
                <div className="flex justify-between items-start">
                    <div>
                        <h4 className="text-xl font-bold text-gray-800">{topic.name}</h4>
                        <div className="flex flex-wrap gap-2 mt-1">
                            <span className="text-sm font-medium text-purple-600 bg-purple-100 px-2 py-0.5 rounded-full inline-block">
                                {subjectName}
                            </span>
                            <span className="text-xs font-semibold text-gray-700 bg-gray-100 px-2 py-0.5 rounded-full inline-block">
                                {typeBadge}
                            </span>
                        </div>
                        <p className="text-xs text-gray-500 mt-2">
                            {topic.type === 'revision' ? 'First Studied:' : 'Created/Due:'} <span className="font-semibold text-gray-700">{initialStudyDate}</span>
                        </p>
                    </div>
                    <div className={`text-right text-sm font-semibold ${statusColor}`}>
                        {statusText}
                        {topic.type === 'revision' && (
                            <div className="text-xs text-gray-500 mt-1">
                                Rev: {completedRevisions}/{totalRevisions}
                            </div>
                        )}
                        {topic.type === 'task' && topic.taskDueDate && (
                             <div className="text-xs text-gray-500 mt-1">
                                 Due: {dateToString(topic.taskDueDate)}
                             </div>
                        )}
                    </div>
                </div>

                {/* Display Subtopics/Problems */}
                {hasSubtopics && (
                    <div className="bg-gray-50 p-3 rounded-lg border border-gray-100 max-h-40 overflow-y-auto">
                        <h5 className="text-xs font-bold text-gray-600 mb-2 border-b pb-1">Problems ({topic.subtopics.length})</h5>
                        <ul className="space-y-1">
                            {topic.subtopics.map((sub, index) => (
                                <li key={index} className="flex justify-between text-sm text-gray-800">
                                    <span className="font-medium truncate">{sub.name}</span>
                                    <span className="text-xs font-mono bg-gray-200 px-2 rounded-full text-gray-700 ml-2 flex-shrink-0">
                                        {sub.number || 'No #'}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
                
                {/* Visual Progress Bar Improvement */}
                 {topic.type === 'revision' && (
                    <div className="pt-2">
                        <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                            <div
                                className={`h-full bg-green-500 transition-all duration-500`}
                                style={{ width: `${progressPercent}%` }}
                            ></div>
                        </div>
                    </div>
                 )}

                <div className="flex space-x-2 pt-2 border-t border-gray-100">
                    {/* Mark Done button is always shown for incomplete items */}
                    {!isComplete && (
                        <Button 
                            variant="success" 
                            onClick={() => onMarkDone(topic)} 
                            className="flex-1"
                        >
                            Mark Done
                        </Button>
                    )}
                    {/* Shift button only for Missed Revision Topics */}
                    {topic.type === 'revision' && isMissed && (
                        <Button variant="danger" onClick={() => onShift(topic.id, currentRevision.targetDate)} className="flex-1">
                            Shift 1D
                        </Button>
                    )}
                    {/* Edit button is always available */}
                    <Button variant="info" onClick={() => onEdit(topic)} className="flex-1">
                        Edit
                    </Button>
                    {/* Delete (Move to Bin) button */}
                    <Button variant="secondary" onClick={() => onDelete(topic.id)} className={`w-1/3`}>
                        <Trash2 className="w-4 h-4 mx-auto" />
                    </Button>
                </div>
            </div>
        );
    };


    // --- Main UI Render ---
    return (
        <div className="min-h-screen bg-gray-50 flex flex-col">
            {/* Header and Controls */}
            <header className="bg-white shadow-md p-4 sticky top-0 z-10">
                <div className="max-w-6xl mx-auto flex flex-col gap-2"> {/* Stack on mobile */}
                    <div className="flex justify-between items-center w-full">
                        <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-800">
                            Revision Hub
                        </h1>
                        <div className="flex space-x-2 sm:space-x-3 items-center flex-shrink-0">
                            <UserInfo />
                            <TimerLogic /> 
                            <Button
                                variant="secondary"
                                onClick={() => signOut(auth)}
                                className="bg-red-100 hover:bg-red-200 text-red-700 px-3 py-1.5 text-xs sm:text-sm"
                            >
                                Logout
                            </Button>
                        </div>
                    </div>

                    {/* Action Buttons (Stacked below H1 on mobile) */}
                    <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100 mt-2 sm:mt-0 sm:border-t-0 sm:pt-0">
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
                            className="flex-1 min-w-[120px] bg-purple-100 hover:bg-purple-200 text-purple-700"
                        >
                            + Add Subject
                        </Button>
                        <Button
                            variant="secondary"
                            onClick={() => setIsRecycleBinOpen(true)}
                            className="flex-1 min-w-[120px] bg-gray-100 hover:bg-gray-200 text-gray-700"
                        >
                            <Trash2 className="w-4 h-4 mr-1" /> Bin ({deletedTopics.filter(t => !t.isPermanentDelete).length})
                        </Button>
                    </div>
                </div>
            </header>

            <main className="flex-1 max-w-6xl mx-auto w-full p-4 sm:p-6">
                
                {/* Subject Filter (Pills) */}
                <div className="bg-white p-4 rounded-xl shadow-lg mb-6">
                    <h3 className="text-lg font-semibold text-gray-700 mb-3">Filter Topics:</h3>
                    <div className="flex flex-wrap gap-2">
                        <Button
                            variant={selectedSubjectFilter === 'all' ? 'primary' : 'secondary'}
                            onClick={() => setSelectedSubjectFilter('all')}
                            className="text-sm px-3 py-1.5"
                        >
                            All ({processedTopics.length})
                        </Button>
                        {subjects.map(subject => (
                            <Button
                                key={subject.id}
                                variant={selectedSubjectFilter === subject.id ? 'info' : 'secondary'}
                                onClick={() => setSelectedSubjectFilter(subject.id)}
                                className="text-sm px-3 py-1.5"
                            >
                                {subject.name}
                            </Button>
                        ))}
                        {/* Reset Filter Button */}
                        {selectedSubjectFilter !== 'all' && (
                            <Button
                                variant="secondary"
                                onClick={() => setSelectedSubjectFilter('all')}
                                className="text-sm px-3 py-1.5 text-red-600 hover:bg-red-100 bg-red-50 border border-red-200"
                            >
                                Clear Filter
                            </Button>
                        )}
                    </div>
                </div>


                {/* Tab Navigation */}
                <div className="flex border-b border-gray-200 mb-6 sticky top-[170px] sm:top-[80px] bg-gray-50">
                    <button onClick={() => setActiveTab('dashboard')} className={tabClasses('dashboard')}>
                        <LayoutDashboard className="w-4 h-4 mx-auto mb-1" /> Dashboard
                    </button>
                    <button onClick={() => setActiveTab('pending')} className={tabClasses('pending')}>
                        <Clock className="w-4 h-4 mx-auto mb-1" /> Pending ({tabCounts.pending})
                    </button>
                    <button onClick={() => setActiveTab('missed')} className={tabClasses('missed')}>
                        <XCircle className="w-4 h-4 mx-auto mb-1" /> Missed ({tabCounts.missed})
                    </button>
                    <button onClick={() => setActiveTab('done')} className={tabClasses('done')}>
                        <CheckCircle className="w-4 h-4 mx-auto mb-1" /> Done ({tabCounts.done})
                    </button>
                    <button onClick={() => setActiveTab('tasks')} className={tabClasses('tasks')}>
                         <List className="w-4 h-4 mx-auto mb-1" /> Tasks ({tabCounts.tasks})
                    </button>
                    <button onClick={() => setActiveTab('calendar')} className={tabClasses('calendar')}>
                        <Calendar className="w-4 h-4 mx-auto mb-1" /> Calendar
                    </button>
                </div>

                {/* Tab Content */}
                {activeTab === 'calendar' && (
                    <CalendarView topics={processedTopics} allSubjects={allSubjects} />
                )}

                {activeTab !== 'calendar' && (
                    <div className="grid md:grid-cols-2 gap-6">
                        {filteredTopics.length > 0 ? (
                            filteredTopics.map(topic => (
                                <TopicCard
                                    key={topic.id}
                                    topic={topic}
                                    subjectName={topic.subjectName}
                                    onMarkDone={handleMarkDoneClick} // Use confirmation handler
                                    onShift={handleShift}
                                    onDelete={handleDeleteClick} // Use soft delete handler
                                    onEdit={handleOpenEditModal}
                                />
                            ))
                        ) : (
                            <div className="col-span-2 bg-white p-8 rounded-xl shadow-lg text-center text-gray-500">
                                <h3 className="text-2xl font-semibold mb-2">No Items Here</h3>
                                {(activeTab === 'dashboard' || activeTab === 'tasks') && <p>Start by clicking "+ Add Item" above!</p>}
                                {activeTab === 'pending' && <p>You are all caught up! No revisions or tasks due soon.</p>}
                                {activeTab === 'missed' && <p>Great job! No missed revisions.</p>}
                                {activeTab === 'done' && <p>Keep revising to move topics here!</p>}
                            </div>
                        )}
                    </div>
                )}
            </main>

            {/* Modals */}
            <AddTopicForm
                userId={userId}
                subjects={subjects}
                isOpen={isAddTopicModalOpen}
                onClose={() => setIsAddTopicModalOpen(false)}
                onAddTopic={handleAddTopic}
            />
            {/* Simplified AddSubjectForm call (since logic is simple) */}
            <Modal isOpen={isAddSubjectModalOpen} onClose={() => setIsAddSubjectModalOpen(false)} title="Add New Subject">
                <AddSubjectForm userId={userId} onClose={() => setIsAddSubjectModalOpen(false)} />
            </Modal>
            
            {topicToEdit && (
                <EditTopicModal
                    userId={userId}
                    topic={topicToEdit}
                    subjects={subjects}
                    isOpen={isEditTopicModalOpen}
                    onClose={() => setIsEditTopicModalOpen(false)}
                    onSave={handleEditTopic}
                />
            )}
            <RecycleBinModal
                userId={userId}
                deletedTopics={deletedTopics}
                isOpen={isRecycleBinOpen}
                onClose={() => setIsRecycleBinOpen(false)}
                onRecover={handleRecover}
                onEmptyBin={(ids) => handlePermanentDelete(ids)}
            />
            {/* Confirmation Modal (Centralized confirmation for Mark Done and Delete) */}
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


// --- Main App Component ---

const App = () => {
    const [userId, setUserId] = useState(null);
    const [isLoading, setIsLoading] = useState(true); // Tracks initial auth state
    const [topics, setTopics] = useState([]);
    const [subjects, setSubjects] = useState([]);
    const [allSubjects, setAllSubjects] = useState({});
    const [isAppInitialized, setIsAppInitialized] = useState(false);

    // 1. Authentication Listener (Handles login persistence)
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            if (user) {
                setUserId(user.uid);
            } else {
                setUserId(null);
            }
            setIsLoading(false); 
        });

        // Set to true once the initial auth state has been checked
        // This ensures the initial loading state is only shown once.
        setIsAppInitialized(true); 

        return () => unsubscribe();
    }, []);


    // 2. Data Listener for Subjects
    useEffect(() => {
        if (!userId) {
            setSubjects([]);
            setAllSubjects({});
            return;
        }

        const q = query(getSubjectsCollection(userId));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const fetchedSubjects = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
            setSubjects(fetchedSubjects);

            // Create subject map for quick lookup in topic filtering
            const subjectMap = fetchedSubjects.reduce((acc, subject) => {
                acc[subject.id] = subject;
                return acc;
            }, {});
            setAllSubjects(subjectMap);
        }, (error) => {
            console.error("Error listening to subjects:", error);
        });

        return () => unsubscribe();
    }, [userId]);


    // 3. Data Listener for Topics
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


    if (isLoading || !isAppInitialized) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-blue-500"></div>
                <p className="ml-4 text-xl text-gray-700 font-semibold">Checking session...</p>
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
            subjects={subjects}
            allSubjects={allSubjects}
        />
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
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
            <div className="bg-white p-8 rounded-xl shadow-2xl w-full max-w-sm">
                <h2 className="text-3xl font-bold text-gray-800 text-center mb-6">
                    {isLogin ? 'Login' : 'Register'}
                </h2>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <input
                        type="email"
                        placeholder="Email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 transition-colors"
                        disabled={loading}
                    />
                    <input
                        type="password"
                        placeholder="Password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 transition-colors"
                        disabled={loading}
                    />

                    {error && (
                        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg text-sm" role="alert">
                            {error}
                        </div>
                    )}
                    {successMessage && (
                        <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded-lg text-sm" role="alert">
                            {successMessage}
                        </div>
                    )}

                    <Button type="submit" variant="primary" className="w-full" disabled={loading}>
                        {loading ? 'Processing...' : (isLogin ? 'Sign In' : 'Create Account')}
                    </Button>
                </form>

                <p className="mt-6 text-center text-sm">
                    {isLogin ? "Don't have an account?" : "Already have an account?"}
                    <button
                        onClick={() => {
                            setIsLogin(!isLogin);
                            setError('');
                            setSuccessMessage('');
                            setEmail('');
                            setPassword('');
                        }}
                        className="text-blue-600 hover:text-blue-800 font-semibold ml-1 transition-colors"
                        disabled={loading}
                    >
                        {isLogin ? 'Register' : 'Login'}
                    </button>
                </p>
            </div>
        </div>
    );
};


export default App;
