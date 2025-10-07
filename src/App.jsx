// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged } from "firebase/auth";
import { getFirestore, doc, collection, onSnapshot, setDoc, query, updateDoc, deleteDoc, writeBatch } from "firebase/firestore";
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'; // Added useRef

// Your web app's Firebase configuration (Hardcoded with User's provided values for deployment)
const firebaseConfig = {
  apiKey: "AIzaSyBQClGa9ETCMXWejXWuBTlTZB8T584MFus",
  authDomain: "spaced-revison-mynew08923.firebaseapp.com",
  projectId: "spaced-revison-mynew08923",
  storageBucket: "spaced-revison-mynew08923.firebasestorage.app",
  messagingSenderId: "667074025327",
  appId: "1:667074025327:web:9d1d38a6bf29edfcbe7a9a",
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

const today = () => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date;
};

const dateToString = (date) => {
    if (!date) return 'N/A';
    // Ensure date is a Date object, if it's a Firestore Timestamp convert it.
    const d = date.toDate ? date.toDate() : date;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const dateToISOString = (date) => {
    const d = date.toDate ? date.toDate() : date;
    // Format: YYYY-MM-DD
    return d.toISOString().split('T')[0];
};

// --- Revision Logic ---

const REVISION_SCHEDULE = [1, 3, 7, 15, 30]; // Days after initial study date

// Generates the full schedule relative to the initial study date
const generateSchedule = (initialDate) => {
    const initial = initialDate.toDate ? initialDate.toDate() : initialDate; // Ensure it's a Date object
    
    return REVISION_SCHEDULE.map(days => {
        const targetDate = new Date(initial); // Start calculation from the initial study date
        targetDate.setDate(initial.getDate() + days); // Add the interval days
        targetDate.setHours(0, 0, 0, 0); // Ensure consistency
        
        return {
            targetDate: targetDate.getTime(),
            completed: false,
            interval: days,
        }
    });
};

const getStatusText = (currentRevision, totalRevisions) => {
    if (!currentRevision) {
        return `Completed ${totalRevisions}/${REVISION_SCHEDULE.length} Revisions`;
    }
    const targetDate = currentRevision.targetDate;
    const date = new Date(targetDate);
    const todayMs = today().getTime();

    if (targetDate < todayMs) {
        return `Missed: Due ${dateToString(date)}`;
    } else if (targetDate === todayMs) {
        return 'Due Today';
    } else {
        return `Next: ${dateToString(date)}`;
    }
};

// --- Components ---

const Button = ({ children, onClick, className = '', disabled = false, variant = 'primary', type = 'button' }) => { // Added type='button' default
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
        case 'disabled':
            colorStyle = 'bg-gray-400 text-gray-600 cursor-not-allowed';
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
            type={type} // Use provided type (default is 'button')
        >
            {children}
        </button>
    );
};

// --- Modals ---

const Modal = ({ isOpen, onClose, title, children }) => {
    if (!isOpen) return null;

    return (
        // Added max-w-full and fluid margin/padding for mobile view
        <div className="fixed inset-0 z-50 overflow-y-auto" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
            <div className="flex items-center justify-center min-h-screen p-4">
                <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm sm:max-w-lg transform transition-all">
                    <div className="px-6 py-4 border-b flex justify-between items-center">
                        <h3 className="text-xl font-bold text-gray-800">{title}</h3>
                        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors" type="button">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
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

const AddSubjectForm = ({ userId, isOpen, onClose }) => {
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
            console.error('Failed to add subject. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Add New Subject">
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
                    {/* The submission button for THIS form *must* be type="submit" */}
                    <Button type="submit" variant="primary" disabled={loading || !name.trim()}>
                        {loading ? 'Adding...' : 'Add Subject'}
                    </Button>
                </div>
            </form>
        </Modal>
    );
};

// --- Subtopic List Component ---

const SubtopicInputList = ({ subtopics, setSubtopics, disabled }) => {
    // Ref to manage unique IDs for subtopics within the modal session
    const nextSubtopicId = useRef(0);

    // Initialize ID counter when component mounts/opens
    useEffect(() => {
        // Find the highest ID among existing subtopics or start from a high number
        const maxId = subtopics.reduce((max, sub) => Math.max(max, sub.id || 0), 0);
        // Ensure starting point is unique (higher than max existing ID or high random number)
        nextSubtopicId.current = Math.max(maxId + 1, Date.now()); 
    }, [subtopics]); // Depend on subtopics to re-check if list is reset/edited

    // Function to add a new empty subtopic entry
    const addSubtopic = () => {
        const newId = nextSubtopicId.current++;
        setSubtopics([...subtopics, { id: newId, name: '', number: '' }]);
    };
    
    // Function to update a specific subtopic field (name or number)
    const updateSubtopic = (id, field, value) => {
        setSubtopics(subtopics.map(sub => 
            sub.id === id ? { ...sub, [field]: value } : sub
        ));
    };

    // Function to remove a subtopic
    const removeSubtopic = (id) => {
        setSubtopics(subtopics.filter(sub => sub.id !== id));
    };

    return (
        <div className="space-y-3 p-4 bg-gray-50 rounded-lg border">
            <h4 className="text-base font-semibold text-gray-700">Subtopics / Problems (Optional)</h4>
            
            <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
                {subtopics.map((sub) => (
                    // Use sub.id for stable keys
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
                            type="button" // CRITICAL: Ensures this button NEVER submits the outer form
                            onClick={(e) => { e.stopPropagation(); removeSubtopic(sub.id); }} 
                            className="text-red-500 hover:text-red-700 disabled:opacity-50 flex-shrink-0"
                            disabled={disabled}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.86 11.2a2 2 0 01-2 1.8H7.86a2 2 0 01-2-1.8L5 7m5 4v6m4-6v6m4-10H5" />
                            </svg>
                        </button>
                    </div>
                ))}
            </div>

            <Button 
                type="button" // CRITICAL: Ensures this button NEVER submits the outer form
                onClick={(e) => { e.stopPropagation(); addSubtopic(); }} 
                variant="secondary"
                className="w-full justify-center text-blue-600 bg-blue-100 hover:bg-blue-200 disabled:opacity-50"
                disabled={disabled}
            >
                + Add Problem/Subtopic
            </Button>
        </div>
    );
};

const AddTopicForm = ({ userId, subjects, isOpen, onClose }) => {
    const [topicName, setTopicName] = useState('');
    const [initialDate, setInitialDate] = useState(dateToISOString(today()));
    const [selectedSubjectId, setSelectedSubjectId] = useState('');
    const [subtopics, setSubtopics] = useState([]); // New state for subtopics
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

        // Clean up subtopics: remove empty entries and map to simpler structure
        const cleanedSubtopics = subtopics
            .filter(sub => sub.name.trim() !== '')
            .map(sub => ({ name: sub.name.trim(), number: sub.number.trim() }));
        
        try {
            const topicDocRef = doc(getTopicsCollection(userId));
            const newTopic = {
                id: topicDocRef.id,
                name: topicName.trim(),
                subjectId: selectedSubjectId,
                initialStudyDate: studyDate.getTime(),
                schedule: generateSchedule(studyDate),
                subtopics: cleanedSubtopics, // Save the new subtopics array
                createdAt: Date.now(),
            };

            await exponentialBackoff(() => setDoc(topicDocRef, newTopic));
            
            // Reset state
            setTopicName('');
            setInitialDate(dateToISOString(today()));
            setSubtopics([]);
            onClose();
        } catch (error) {
            console.error('Error adding topic:', error);
            console.error('Failed to add topic. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Add New Topic">
            <form onSubmit={handleSubmit}>
                <input
                    type="text"
                    value={topicName}
                    onChange={(e) => setTopicName(e.target.value)}
                    placeholder="Main Topic Name (e.g., Array Manipulation)"
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
                    <input
                        type="date"
                        value={initialDate}
                        onChange={(e) => setInitialDate(e.target.value)}
                        required
                        className="w-full sm:w-1/2 p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                        disabled={loading}
                    />
                </div>
                
                {/* Subtopic Input List */}
                <SubtopicInputList subtopics={subtopics} setSubtopics={setSubtopics} disabled={loading} />

                <div className="flex justify-end space-x-2 mt-4">
                    <Button variant="secondary" onClick={onClose} disabled={loading}>Cancel</Button>
                    <Button type="submit" variant="primary" disabled={loading || !topicName.trim() || !selectedSubjectId}>
                        {loading ? 'Saving...' : 'Save Topic'}
                    </Button>
                </div>
            </form>
        </Modal>
    );
};

const EditTopicModal = ({ userId, topic, subjects, isOpen, onClose, onSave }) => {
    const initialStudyDateString = topic ? dateToISOString(new Date(topic.initialStudyDate)) : dateToISOString(today());
    const initialSubtopics = topic?.subtopics || [];
    
    const [topicName, setTopicName] = useState(topic?.name || '');
    const [initialDate, setInitialDate] = useState(initialStudyDateString);
    const [selectedSubjectId, setSelectedSubjectId] = useState(topic?.subjectId || '');
    const [subtopics, setSubtopics] = useState(initialSubtopics); 
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (topic) {
            setTopicName(topic.name);
            setSelectedSubjectId(topic.subjectId);
            setInitialDate(dateToISOString(new Date(topic.initialStudyDate)));
            // Map subtopics to include a temporary 'id' for the component keying to prevent re-renders
            // If subtopic already has an id (from a previous edit), keep it. Otherwise, use Math.random() for key stability.
            setSubtopics(topic.subtopics.map(sub => ({...sub, id: sub.id || Math.random()}))); 
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
            await onSave(topic.id, topicName.trim(), selectedSubjectId, initialDate, cleanedSubtopics);
            onClose();
        } catch (error) {
            console.error('Error saving edited topic:', error);
            console.error('Failed to update topic. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`Edit: ${topic?.name || 'Topic'}`}>
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
                    <input
                        type="date"
                        value={initialDate}
                        onChange={(e) => setInitialDate(e.target.value)}
                        required
                        className="w-full sm:w-1/2 p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                        disabled={loading}
                    />
                </div>
                <p className='text-xs text-yellow-600 bg-yellow-50 p-2 rounded-lg mb-4'>
                    *Changing the **Study Date** will recalculate the entire revision schedule.*
                </p>
                
                {/* Subtopic Input List */}
                <SubtopicInputList subtopics={subtopics} setSubtopics={setSubtopics} disabled={loading} />

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


// --- Topic Card ---

const TopicCard = ({ topic, subjectName, onMarkDone, onShift, onDelete, onEdit }) => {
    const totalRevisions = REVISION_SCHEDULE.length;
    const completedRevisions = topic.schedule.filter(s => s.completed).length;
    const currentRevision = topic.schedule.find(s => !s.completed);
    const isComplete = !currentRevision;
    const statusText = isComplete ? getStatusText(null, totalRevisions) : getStatusText(currentRevision, totalRevisions);
    const isMissed = statusText.startsWith('Missed');
    const isDue = statusText === 'Due Today';
    const nextRevisionDate = currentRevision ? new Date(currentRevision.targetDate) : null;
    const daysRemaining = nextRevisionDate ? Math.ceil((nextRevisionDate.getTime() - today().getTime()) / (1000 * 60 * 60 * 24)) : 0;
    
    // Convert initial study date (milliseconds) to display string
    const initialStudyDate = dateToString(new Date(topic.initialStudyDate));
    
    // Calculate progress percentage for visual bar
    const progressPercent = (completedRevisions / totalRevisions) * 100;
    
    const hasSubtopics = topic.subtopics && topic.subtopics.length > 0;

    let cardBorder = 'border-gray-200';
    let statusColor = 'text-gray-600';

    if (isComplete) {
        cardBorder = 'border-green-400';
        statusColor = 'text-green-600';
    } else if (isDue) {
        cardBorder = 'border-blue-500 ring-2 ring-blue-100';
        statusColor = 'text-blue-600';
    } else if (isMissed) {
        cardBorder = 'border-red-500 ring-2 ring-red-100';
        statusColor = 'text-red-600';
    } else if (daysRemaining <= 3 && daysRemaining > 0) {
        cardBorder = 'border-yellow-400';
        statusColor = 'text-yellow-600';
    }

    return (
        <div className={`bg-white border-l-4 ${cardBorder} rounded-xl shadow-lg p-5 flex flex-col space-y-3`}>
            <div className="flex justify-between items-start">
                <div>
                    <h4 className="text-xl font-bold text-gray-800">{topic.name}</h4>
                    <span className="text-sm font-medium text-purple-600 bg-purple-100 px-2 py-0.5 rounded-full inline-block mt-1">
                        {subjectName}
                    </span>
                    <p className="text-xs text-gray-500 mt-2">
                        Studied On: <span className="font-semibold text-gray-700">{initialStudyDate}</span>
                    </p>
                </div>
                <div className={`text-right text-sm font-semibold ${statusColor}`}>
                    {statusText}
                    <div className="text-xs text-gray-500 mt-1">
                        Rev: {completedRevisions}/{totalRevisions}
                    </div>
                </div>
            </div>

            {/* Display Subtopics/Problems */}
            {hasSubtopics && (
                <div className="bg-gray-50 p-3 rounded-lg border border-gray-100 max-h-40 overflow-y-auto">
                    <h5 className="text-xs font-bold text-gray-600 mb-2 border-b pb-1">Problems ({topic.subtopics.length})</h5>
                    <ul className="space-y-1">
                        {topic.subtopics.map((sub, index) => (
                            // Use index as key since the subtopic list is static on the card
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
             <div className="pt-2">
                <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                        className={`h-full bg-green-500 transition-all duration-500`}
                        style={{ width: `${progressPercent}%` }}
                    ></div>
                </div>
            </div>

            <div className="flex space-x-2 pt-2 border-t border-gray-100">
                {!isComplete && (
                    <Button variant="success" onClick={() => onMarkDone(topic)} className="flex-1">
                        Mark Done
                    </Button>
                )}
                {isMissed && (
                    <Button variant="danger" onClick={() => onShift(topic.id, currentRevision.targetDate)} className="flex-1">
                        Shift 1D
                    </Button>
                )}
                <Button variant="info" onClick={() => onEdit(topic)} className="flex-1">
                    Edit
                </Button>
                <Button variant="secondary" onClick={() => onDelete(topic.id)} className={`w-1/3`}>
                    Delete
                </Button>
            </div>
        </div>
    );
};

// --- Calendar View Component ---

const CalendarView = ({ topics, allSubjects }) => {
    const [currentDate, setCurrentDate] = useState(today());

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
            topic.schedule.forEach((scheduleItem, index) => {
                // Only consider future or past-due (pending) items
                if (index < topic.schedule.length && !scheduleItem.completed) {
                    const dateKey = dateToISOString(new Date(scheduleItem.targetDate));
                    if (!map.has(dateKey)) {
                        map.set(dateKey, []);
                    }
                    map.get(dateKey).push({
                        topicName: topic.name,
                        subjectName: allSubjects[topic.subjectId]?.name || 'Unknown',
                        isMissed: scheduleItem.targetDate < today().getTime(),
                    });
                }
            });
        });
        return map;
    }, [topics, allSubjects]);

    const handlePrevMonth = () => {
        const newDate = new Date(currentDate);
        newDate.setMonth(newDate.getMonth() - 1);
        setCurrentDate(newDate);
    };

    const handleNextMonth = () => {
        const newDate = new Date(currentDate);
        newDate.setMonth(newDate.getMonth() + 1);
        setCurrentDate(newDate);
    };

    const handleToday = () => {
        setCurrentDate(today());
    };

    const [selectedDate, setSelectedDate] = useState(null);
    const [modalOpen, setModalOpen] = useState(false);

    const handleDayClick = (dayOfMonth) => {
        const date = new Date(currentDate.getFullYear(), currentDate.getMonth(), dayOfMonth);
        setSelectedDate(date);
        setModalOpen(true);
    };

    const todayISO = dateToISOString(today());

    return (
        <div className="p-4 bg-white rounded-xl shadow-lg">
            <header className="flex justify-between items-center mb-6">
                <Button onClick={handlePrevMonth} variant="secondary">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                </Button>
                <div className="text-xl font-bold text-gray-800 flex flex-col items-center">
                    {currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                    <Button onClick={handleToday} variant="secondary" className="mt-2 py-1 px-3 text-xs">Today</Button>
                </div>
                <Button onClick={handleNextMonth} variant="secondary">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                </Button>
            </header>

            <div className="grid grid-cols-7 gap-1 text-center font-medium text-sm text-gray-500 mb-2">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                    <div key={day} className="py-2 text-blue-600">{day}</div>
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
                    
                    const cellClasses = `h-16 flex flex-col items-center justify-center p-1 rounded-lg transition-colors cursor-pointer 
                                         ${isToday ? 'bg-blue-100 border-2 border-blue-500' : 'bg-gray-50 hover:bg-gray-200'}`;

                    return (
                        <div key={day} className={cellClasses} onClick={() => handleDayClick(day)}>
                            <span className={`font-semibold ${isToday ? 'text-blue-700' : 'text-gray-800'} text-lg`}>{day}</span>
                            {revisionsDue && revisionsDue.length > 0 && (
                                <span className={`text-xs mt-1 px-2 py-0.5 rounded-full ${revisionsDue.some(r => r.isMissed) ? 'bg-red-500 text-white' : 'bg-yellow-400 text-gray-800'}`}>
                                    {revisionsDue.length} due
                                </span>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Revision Details Modal */}
            <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={`Revisions Due on ${dateToString(selectedDate)}`}>
                {selectedDate && revisionMap.has(dateToISOString(selectedDate)) ? (
                    <div className="space-y-3 max-h-96 overflow-y-auto pr-2">
                        {revisionMap.get(dateToISOString(selectedDate)).map((revision, index) => (
                            <div key={index} className={`p-3 rounded-lg shadow-sm border ${revision.isMissed ? 'bg-red-50 border-red-300' : 'bg-green-50 border-green-300'}`}>
                                <p className="font-semibold text-gray-800">{revision.topicName}</p>
                                <span className="text-sm text-gray-600">Subject: {revision.subjectName}</span>
                                {revision.isMissed && <span className="text-sm font-semibold text-red-600 ml-3">(Missed)</span>}
                            </div>
                        ))}
                    </div>
                ) : (
                    <p className="text-gray-500">No revisions scheduled for this date.</p>
                )}
            </Modal>
        </div>
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


// --- App Logic Component ---

const AppLogic = ({ userId, topics, subjects, allSubjects }) => {
    const [activeTab, setActiveTab] = useState('dashboard');
    const [isAddTopicModalOpen, setIsAddTopicModalOpen] = useState(false);
    const [isAddSubjectModalOpen, setIsAddSubjectModalOpen] = useState(false);
    const [isEditTopicModalOpen, setIsEditTopicModalOpen] = useState(false); // New state for edit modal
    const [topicToEdit, setTopicToEdit] = useState(null); // New state for topic being edited

    // State for Confirmation Dialog
    const [confirmAction, setConfirmAction] = useState({
        isOpen: false,
        title: '',
        message: '',
        onConfirm: () => {},
        confirmText: 'Confirm'
    });

    const [selectedSubjectFilter, setSelectedSubjectFilter] = useState('all');

    const handleOpenEditModal = useCallback((topic) => {
        setTopicToEdit(topic);
        setIsEditTopicModalOpen(true);
    }, []);

    // Action to delete a topic, triggering the modal
    const handleDeleteClick = useCallback((topicId) => {
        setConfirmAction({
            isOpen: true,
            title: 'Confirm Deletion',
            message: 'Are you sure you want to permanently delete this topic? This action cannot be undone.',
            onConfirm: () => handleDelete(topicId),
            confirmText: 'Yes, Delete'
        });
    }, []);

    // Action to mark done, triggering the modal
    const handleMarkDoneClick = useCallback((topic) => {
        // Pass the full topic object to avoid lookup race condition
        setConfirmAction({
            isOpen: true,
            title: 'Confirm Revision',
            message: `Are you sure you want to mark "${topic.name}" as DONE for this revision?`,
            onConfirm: () => handleMarkDone(topic),
            confirmText: 'Mark Done'
        });
    }, []);


    // CORE FUNCTION: Marks the revision as complete (called by modal)
    const handleMarkDone = useCallback(async (topic) => {
        // FIX: Ensure topic and ID are valid before calling doc()
        if (!userId || !topic || !topic.id) { 
            console.error("Attempted to mark done with invalid topic or ID.");
            return;
        }
        
        const topicRef = doc(getTopicsCollection(userId), topic.id);
        const currentRevision = topic.nextRevision; // Get the next scheduled revision from the passed object

        if (!currentRevision) {
             console.error("Attempted to mark done without a next revision.");
             return;
        }


        try {
            await exponentialBackoff(async () => {
                const batch = writeBatch(db);
                
                // Find and update the specific schedule item
                const updatedSchedule = topic.schedule.map(s => {
                    if (s.targetDate === currentRevision.targetDate) {
                        return { ...s, completed: true, completedDate: Date.now() };
                    }
                    return s;
                });

                batch.update(topicRef, { schedule: updatedSchedule });
                await batch.commit();
            });

        } catch (error) {
            console.error('Error marking revision done:', error);
            console.error('Failed to update topic. Please try again.');
        }
    }, [userId]);
    
    // CORE FUNCTION: Deletes the topic (called by modal)
    const handleDelete = useCallback(async (topicId) => {
        if (!userId || !topicId) return; // Defensive check for topicId
        const topicRef = doc(getTopicsCollection(userId), topicId);
        try {
            await exponentialBackoff(() => deleteDoc(topicRef));
        } catch (error) {
            console.error('Error deleting topic:', error);
            console.error('Failed to delete topic. Please try again.');
        }
    }, [userId]);


    const handleShift = useCallback(async (topicId, missedTargetDate) => {
        if (!userId || !topicId) return; // Defensive check for topicId
        const topicRef = doc(getTopicsCollection(userId), topicId);

        try {
            await exponentialBackoff(async () => {
                const batch = writeBatch(db);
                const topic = topics.find(t => t.id === topicId);
                if (!topic) return;

                const updatedSchedule = topic.schedule.map(s => {
                    // Only shift uncompleted revisions that are due on or after the missed date
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
            console.error('Failed to shift revision date. Please try again.');
        }
    }, [userId, topics]);
    
    // Handle Editing Topic Details - UPDATED to accept subtopics
    const handleEditTopic = useCallback(async (topicId, name, subjectId, initialDateString, subtopics) => {
        if (!userId || !topicId) return; // Defensive check for topicId
        
        const topicRef = doc(getTopicsCollection(userId), topicId);
        const existingTopic = topics.find(t => t.id === topicId);
        
        const newStudyDate = new Date(initialDateString);
        newStudyDate.setHours(0, 0, 0, 0);
        const newStudyDateMs = newStudyDate.getTime();
        const originalStudyDateMs = existingTopic.initialStudyDate;
        
        let updateData = {
            name: name,
            subjectId: subjectId,
            subtopics: subtopics, // Include subtopics
        };

        // If initial study date has changed, recalculate the entire schedule
        if (newStudyDateMs !== originalStudyDateMs) {
            updateData.initialStudyDate = newStudyDateMs;
            // Generate a *new* full schedule based on the new start date
            updateData.schedule = generateSchedule(newStudyDate);
        }

        try {
            await exponentialBackoff(() => updateDoc(topicRef, updateData));
        } catch (error) {
            console.error('Error updating topic:', error);
            console.error('Failed to update topic details. Please try again.');
            throw error; 
        }
    }, [userId, topics]);


    // --- Data Filtering and Sorting (Memoized) ---
    const processedTopics = useMemo(() => {
        const todayMs = today().getTime();

        return topics.map(topic => {
            const completedCount = topic.schedule.filter(s => s.completed).length;
            const nextRevision = topic.schedule.find(s => !s.completed) || null;
            const isComplete = !nextRevision;

            const isPending = nextRevision && nextRevision.targetDate <= todayMs;
            const isMissed = isPending && nextRevision.targetDate < todayMs;
            const isDone = completedCount > 0;
            
            // Ensure subtopics is an array, defaults to empty array
            const subtopics = topic.subtopics || [];

            return {
                ...topic,
                completedCount,
                nextRevision,
                isComplete,
                isPending,
                isMissed,
                isDone,
                subtopics: subtopics, // Include processed subtopics
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
                list = list.filter(t => t.isPending && !t.isMissed);
                break;
            case 'missed':
                list = list.filter(t => t.isMissed);
                break;
            case 'done':
                // Done tab includes all topics that have completed at least one revision AND are not fully complete
                list = list.filter(t => t.isDone && !t.isComplete);
                break;
            case 'dashboard':
            default:
                // Dashboard shows all topics
                break;
        }

        // Default sorting: Missed > Due Today > Soonest Next Date > Completed
        return list.sort((a, b) => {
            // Sort by completion status (Incomplete first)
            if (a.isComplete !== b.isComplete) {
                return a.isComplete ? 1 : -1;
            }
            // Sort by missed status (Missed first)
            if (a.isMissed !== b.isMissed) {
                return a.isMissed ? -1 : 1;
            }
            // Sort by due status (Due today first)
            if (a.isPending !== b.isPending) {
                return a.isPending ? -1 : 1;
            }
            // Sort by next date (Soonest next date first)
            const aDate = a.nextRevision?.targetDate || Infinity;
            const bDate = b.nextRevision?.targetDate || Infinity;
            return aDate - bDate;
        });
    }, [processedTopics, activeTab, selectedSubjectFilter]);

    // --- Tab Counts ---
    const tabCounts = useMemo(() => ({
        pending: processedTopics.filter(t => t.isPending && !t.isMissed).length,
        missed: processedTopics.filter(t => t.isMissed).length,
        done: processedTopics.filter(t => t.isDone && !t.isComplete).length,
    }), [processedTopics]);

    const tabClasses = (tab) => (
        `flex-1 text-center py-2 font-semibold transition-colors rounded-t-lg text-xs sm:text-sm 
        ${activeTab === tab ? 'bg-white shadow-inner text-blue-600 border-b-2 border-blue-600' : 'text-gray-600 hover:text-blue-500'}`
    );


    // --- User Info Helper Component ---
    const UserInfo = () => {
        const truncatedId = userId ? `${userId.substring(0, 4)}...${userId.substring(userId.length - 4)}` : 'N/A';
        return (
            <div className="flex items-center text-xs sm:text-sm text-gray-500 bg-gray-100 p-2 rounded-lg shadow-inner flex-shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1 text-blue-500" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                </svg>
                <span className="hidden sm:inline font-semibold text-gray-700">User ID:</span>
                <code className="ml-1 text-blue-600 font-mono text-xs">{truncatedId}</code>
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
                            + Add Topic
                        </Button>
                        <Button
                            variant="secondary"
                            onClick={() => setIsAddSubjectModalOpen(true)}
                            className="flex-1 min-w-[120px] bg-purple-100 hover:bg-purple-200 text-purple-700"
                        >
                            + Add Subject
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
                        {/* New Feature: Reset Filter Button */}
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
                <div className="flex border-b border-gray-200 mb-6 sticky top-[130px] sm:top-[80px] bg-gray-50 z-10">
                    <button onClick={() => setActiveTab('dashboard')} className={tabClasses('dashboard')}>
                        Dashboard
                    </button>
                    <button onClick={() => setActiveTab('pending')} className={tabClasses('pending')}>
                        Pending ({tabCounts.pending})
                    </button>
                    <button onClick={() => setActiveTab('missed')} className={tabClasses('missed')}>
                        Missed ({tabCounts.missed})
                    </button>
                    <button onClick={() => setActiveTab('done')} className={tabClasses('done')}>
                        Done ({tabCounts.done})
                    </button>
                    <button onClick={() => setActiveTab('calendar')} className={tabClasses('calendar')}>
                        Calendar
                    </button>
                </div>

                {/* Tab Content */}
                {activeTab === 'calendar' && (
                    <CalendarView topics={topics} allSubjects={allSubjects} />
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
                                    onDelete={handleDeleteClick} // Use confirmation handler
                                    onEdit={handleOpenEditModal}
                                />
                            ))
                        ) : (
                            <div className="col-span-2 bg-white p-8 rounded-xl shadow-lg text-center text-gray-500">
                                <h3 className="text-2xl font-semibold mb-2">No Topics Here</h3>
                                {activeTab === 'dashboard' && <p>Start by clicking "Add Topic" above!</p>}
                                {activeTab === 'pending' && <p>You are all caught up! No revisions due today.</p>}
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
            />
            <AddSubjectForm
                userId={userId}
                subjects={subjects}
                isOpen={isAddSubjectModalOpen}
                onClose={() => setIsAddSubjectModalOpen(false)}
            />
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

    // 1. Authentication Listener (Handles login persistence)
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            if (user) {
                setUserId(user.uid);
            } else {
                setUserId(null);
            }
            setIsLoading(false); // Auth state check is complete
        });

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


    if (isLoading) {
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

// --- Render ---

export default App; // Export App as the main component
