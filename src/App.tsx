/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  Calculator, 
  Stethoscope, 
  Clock, 
  Users, 
  DollarSign, 
  Settings, 
  ChevronDown, 
  ChevronUp,
  Info,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  Wallet,
  CheckCircle2,
  Edit,
  Trash2,
  Save,
  FolderOpen,
  FileText,
  FilePlus,
  Plus,
  X,
  Calendar,
  LogIn,
  LogOut,
  ExternalLink,
  User as UserIcon,
  CheckCircle2 as CheckIcon,
  Archive,
  Printer,
  PlusCircle,
  MinusCircle,
  History,
  Download,
  RotateCcw,
  FileDown
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { 
  auth, 
  db, 
  signInWithGoogle, 
  logout, 
  onAuthStateChanged, 
  collection, 
  doc, 
  setDoc, 
  getDoc,
  onSnapshot, 
  deleteDoc, 
  updateDoc, 
  handleFirestoreError, 
  OperationType,
  User
} from './firebase';
import { Component, ErrorInfo, ReactNode } from 'react';

// --- Error Boundary ---

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      let errorMessage = "Algo salió mal.";
      try {
        const firestoreError = JSON.parse(this.state.error?.message || "{}");
        if (firestoreError.error) {
          errorMessage = `Error de base de datos: ${firestoreError.error}`;
        }
      } catch (e) {
        errorMessage = this.state.error?.message || errorMessage;
      }

      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
          <div className="bg-white p-8 rounded-3xl shadow-xl max-w-md w-full text-center space-y-4">
            <div className="w-16 h-16 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto">
              <AlertCircle className="w-8 h-8" />
            </div>
            <h1 className="text-xl font-bold text-slate-900">¡Ups! Ha ocurrido un error</h1>
            <p className="text-slate-600 text-sm">{errorMessage}</p>
            <button 
              onClick={() => window.location.reload()}
              className="w-full py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all"
            >
              Recargar aplicación
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// --- Types ---

interface Deduction {
  id: string;
  concept: string;
  amount: number;
  periodId?: string;
}

interface BillingPeriod {
  id: string;
  userId: string;
  name: string;
  startDate: string;
  endDate: string;
  status: 'active' | 'archived';
  createdAt: string;
  totalGross?: number;
}

interface SavedCalculation {
  id: string;
  name: string;
  timestamp: string;
  records: ShiftRecord[];
  rates: Rates;
  additionalDeductions: Deduction[];
}

interface Rates {
  hourly: {
    day: number;
    night: number;
    holidayDay: number;
    holidayNight: number;
  };
  ava: {
    day: number;
    night: number;
    holidayDay: number;
    holidayNight: number;
  };
  patient: {
    day: number;
    night: number;
    holidayDay: number;
    holidayNight: number;
  };
  payroll: {
    uvtValue: number;
    dependents: boolean; // 10% of gross or 32 UVT
    prepagada: number; // Max 16 UVT
    pensionVoluntaria: number; // Max 30% of income or 3800 UVT/year
    interesesVivienda: number; // Max 100 UVT
    avgBilling12Months: number; // For Vacations proportional
    avgBilling6Months: number;  // For Prima proportional
    billingCutoffDay: number;   // Day of the month for billing cutoff
    nightShiftStart: number;    // Hour when night shift starts (e.g., 19 for 7 PM)
  };
}

interface ShiftInput {
  date: string;
  startTime: string;
  endTime: string;
  isHolidayStart: boolean;
  isHolidayEnd: boolean;
  isAVAShift: boolean;
}

interface Quantities {
  hours: {
    day: number;
    night: number;
    holidayDay: number;
    holidayNight: number;
  };
  ava: {
    day: number;
    night: number;
    holidayDay: number;
    holidayNight: number;
  };
  patients: {
    day: number;
    night: number;
    holidayDay: number;
    holidayNight: number;
  };
  applyPatients: boolean;
}

interface ShiftRecord {
  id: string;
  userId: string;
  periodId?: string;
  date: string;
  startTime: string;
  endTime: string;
  hours: Quantities['hours'];
  ava: Quantities['ava'];
  patients: Quantities['patients'];
  applyPatients: boolean;
  isDefinitive: boolean;
}

// --- Constants ---

const SMMLV_2026 = 1750905;

const DEFAULT_RATES: Rates = {
  hourly: {
    day: 23339.04,
    night: 31509.33,
    holidayDay: 40845.85,
    holidayNight: 49012.90,
  },
  ava: {
    day: 37710.01,
    night: 50908.01,
    holidayDay: 65993.37,
    holidayNight: 79192.49,
  },
  patient: {
    day: 10826.13,
    night: 14616.61,
    holidayDay: 18945.71,
    holidayNight: 22735.11,
  },
  payroll: {
    uvtValue: 49786, // Estimated for 2026
    dependents: false,
    prepagada: 0,
    pensionVoluntaria: 0,
    interesesVivienda: 0,
    avgBilling6Months: 0,
    avgBilling12Months: 0,
    billingCutoffDay: 29,
    nightShiftStart: 19,
  }
};

// --- Helper Functions ---

const sortRecords = (records: ShiftRecord[]) => {
  return [...records].sort((a, b) => {
    const dateCompare = a.date.localeCompare(b.date);
    if (dateCompare !== 0) return dateCompare;
    return a.startTime.localeCompare(b.startTime);
  });
};

const formatCurrency = (value: number) => {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 2,
  }).format(value);
};

export default function App() {
  return (
    <ErrorBoundary>
      <MainApp />
    </ErrorBoundary>
  );
}

function MainApp() {
  console.log("MainApp: Rendering...");
  // --- Auth State ---
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // --- State ---
  const [rates, setRates] = useState<Rates>(DEFAULT_RATES);
  const ratesRef = useRef<Rates>(rates);
  useEffect(() => {
    ratesRef.current = rates;
  }, [rates]);

  const [shift, setShift] = useState<ShiftInput>({
    date: new Date().toISOString().split('T')[0],
    startTime: '07:00',
    endTime: '19:00',
    isHolidayStart: false,
    isHolidayEnd: false,
    isAVAShift: false,
  });
  const [quantities, setQuantities] = useState<Quantities>({
    hours: { day: 0, night: 0, holidayDay: 0, holidayNight: 0 },
    ava: { day: 0, night: 0, holidayDay: 0, holidayNight: 0 },
    patients: { day: 0, night: 0, holidayDay: 0, holidayNight: 0 },
    applyPatients: true,
  });
  const [records, setRecords] = useState<ShiftRecord[]>([]);
  const [additionalDeductions, setAdditionalDeductions] = useState<Deduction[]>([]);
  const [periods, setPeriods] = useState<BillingPeriod[]>([]);
  const [activePeriod, setActivePeriod] = useState<BillingPeriod | null>(null);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);
  const [showPeriodModal, setShowPeriodModal] = useState(false);
  const [newPeriodData, setNewPeriodData] = useState({
    name: '',
    startDate: '',
    endDate: ''
  });

  // --- Auth Effect ---
  useEffect(() => {
    console.log("App: Component mounted");
    console.log("Auth Effect: Setting up listener...");
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      console.log("Auth State Changed:", currentUser ? `User ${currentUser.uid}` : "No user");
      setUser(currentUser);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  const handleLogin = async () => {
    console.log("Login button clicked - Start");
    setIsLoggingIn(true);
    setAuthError(null);
    try {
      console.log("Calling signInWithGoogle...");
      const result = await signInWithGoogle();
      console.log("Login successful:", result.user.uid);
    } catch (error: any) {
      console.error("Detailed Login error:", error);
      let message = "Error al iniciar sesión. Por favor, intenta de nuevo.";
      
      const errorCode = error.code || "";
      const errorMessage = error.message || "";
      const currentDomain = window.location.hostname;

      if (errorCode === 'auth/popup-blocked') {
        message = "El navegador bloqueó la ventana emergente. Por favor, permite las ventanas emergentes para este sitio.";
      } else if (errorCode === 'auth/unauthorized-domain' || errorMessage.includes('auth/unauthorized-domain')) {
        message = `Este dominio (${currentDomain}) no está autorizado en la consola de Firebase. Por favor, agrégalo a la lista de dominios autorizados en la configuración de Firebase Auth.`;
      } else if (errorCode === 'auth/cancelled-popup-request' || errorCode === 'auth/popup-closed-by-user') {
        message = "La ventana de inicio de sesión se cerró antes de completar el proceso.";
      } else if (errorCode === 'auth/network-request-failed') {
        message = "Error de red. Por favor, verifica tu conexión a internet.";
      } else if (errorCode === 'auth/internal-error') {
        message = "Error interno de Firebase. Por favor, intenta de nuevo más tarde.";
      } else {
        message = `Error técnico (${errorCode || 'unknown'}): ${errorMessage}`;
      }
      
      setAuthError(message);
    } finally {
      setIsLoggingIn(false);
      console.log("Login flow finished");
    }
  };

  // --- Firestore Sync ---
  // --- Rates Sync ---
  useEffect(() => {
    if (!isAuthReady || !user) {
      setRates(DEFAULT_RATES);
      return;
    }

    const userPath = `users/${user.uid}`;
    const unsubscribeUser = onSnapshot(doc(db, userPath), (snapshot) => {
      if (snapshot.exists()) {
        const userData = snapshot.data();
        if (userData.rates) {
          // Only update if different to avoid loops
          if (JSON.stringify(userData.rates) !== JSON.stringify(ratesRef.current)) {
            setRates(userData.rates);
          }
        }
      } else {
        // Create user document if it doesn't exist
        const newUser = {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL,
          createdAt: new Date().toISOString(),
          rates: DEFAULT_RATES
        };
        setDoc(doc(db, userPath), newUser).catch(err => 
          handleFirestoreError(err, OperationType.CREATE, userPath)
        );
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, userPath);
    });

    return () => unsubscribeUser();
  }, [isAuthReady, user]);

  // Save rates whenever they change locally
  useEffect(() => {
    if (!isAuthReady || !user) return;

    const userPath = `users/${user.uid}`;
    // We use a timeout to debounce updates to Firestore
    const timeout = setTimeout(() => {
      updateDoc(doc(db, userPath), { rates }).catch(err => 
        handleFirestoreError(err, OperationType.UPDATE, userPath)
      );
    }, 1000);

    return () => clearTimeout(timeout);
  }, [rates, user, isAuthReady]);

  useEffect(() => {
    if (!isAuthReady || !user) {
      setRecords([]);
      setAdditionalDeductions([]);
      setPeriods([]);
      setActivePeriod(null);
      setSelectedPeriodId(null);
      return;
    }

    // Sync Periods
    const periodsPath = `users/${user.uid}/periods`;
    const unsubscribePeriods = onSnapshot(collection(db, periodsPath), (snapshot) => {
      const periodsData = snapshot.docs.map(doc => doc.data() as BillingPeriod);
      const sortedPeriods = periodsData.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      setPeriods(sortedPeriods);
      
      const active = sortedPeriods.find(p => p.status === 'active');
      setActivePeriod(active || null);
      
      // If no period is selected, default to the active one or the latest archived one
      if (!selectedPeriodId) {
        if (active) {
          setSelectedPeriodId(active.id);
        } else if (sortedPeriods.length > 0) {
          setSelectedPeriodId(sortedPeriods[0].id);
        }
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, periodsPath);
    });

    return () => {
      unsubscribePeriods();
    };
  }, [isAuthReady, user]);

  useEffect(() => {
    if (!isAuthReady || !user || !selectedPeriodId) {
      setRecords([]);
      setAdditionalDeductions([]);
      return;
    }

    const recordsPath = `users/${user.uid}/records`;
    const unsubscribeRecords = onSnapshot(collection(db, recordsPath), (snapshot) => {
      const recordsData = snapshot.docs
        .map(doc => doc.data() as ShiftRecord)
        .filter(r => r.periodId === selectedPeriodId);
      setRecords(sortRecords(recordsData));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, recordsPath);
    });

    const deductionsPath = `users/${user.uid}/deductions`;
    const unsubscribeDeductions = onSnapshot(collection(db, deductionsPath), (snapshot) => {
      const deductionsData = snapshot.docs
        .map(doc => doc.data() as Deduction)
        .filter(d => d.periodId === selectedPeriodId);
      setAdditionalDeductions(deductionsData);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, deductionsPath);
    });

    return () => {
      unsubscribeRecords();
      unsubscribeDeductions();
    };
  }, [isAuthReady, user, selectedPeriodId]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [showDetails, setShowDetails] = useState(false);
  const [savedCalculations, setSavedCalculations] = useState<SavedCalculation[]>([]);
  const [calcName, setCalcName] = useState('');
  const [autoCalculatePatients, setAutoCalculatePatients] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewingArchive, setViewingArchive] = useState<SavedCalculation | null>(null);

  // Load saved calculations from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('med_payroll_saved');
    if (saved) {
      try {
        setSavedCalculations(JSON.parse(saved));
      } catch (e) {
        console.error('Error loading saved calculations', e);
      }
    }
  }, []);

  // Save to localStorage whenever savedCalculations changes
  useEffect(() => {
    localStorage.setItem('med_payroll_saved', JSON.stringify(savedCalculations));
  }, [savedCalculations]);

  // --- Logic: Calculate Hours Distribution ---
  const calculateShiftDistribution = (s: { startTime: string, endTime: string, isHolidayStart: boolean, isHolidayEnd: boolean }, r: typeof rates) => {
    const [startH, startM] = s.startTime.split(':').map(Number);
    const [endH, endM] = s.endTime.split(':').map(Number);

    let start = new Date(2000, 0, 1, startH, startM);
    let end = new Date(2000, 0, 1, endH, endM);

    if (end <= start) {
      end = new Date(2000, 0, 2, endH, endM);
    }

    let minsD = 0, minsN = 0, minsDF = 0, minsNF = 0;
    let current = new Date(start);

    while (current < end) {
      const isSecondDay = current.getDate() > start.getDate();
      const isHolidayNow = isSecondDay ? s.isHolidayEnd : s.isHolidayStart;
      
      const hour = current.getHours();
      const isDaytime = hour >= 6 && hour < r.payroll.nightShiftStart;

      if (isDaytime && !isHolidayNow) minsD++;
      else if (!isDaytime && !isHolidayNow) minsN++;
      else if (isDaytime && isHolidayNow) minsDF++;
      else if (!isDaytime && isHolidayNow) minsNF++;

      current.setMinutes(current.getMinutes() + 1);
    }

    return {
      day: Math.round((minsD / 60) * 100) / 100,
      night: Math.round((minsN / 60) * 100) / 100,
      holidayDay: Math.round((minsDF / 60) * 100) / 100,
      holidayNight: Math.round((minsNF / 60) * 100) / 100,
    };
  };

  useEffect(() => {
    const calculateDistribution = () => {
      const h = calculateShiftDistribution(shift, rates);

      setQuantities(prev => {
        return {
          ...prev,
          hours: shift.isAVAShift ? { day: 0, night: 0, holidayDay: 0, holidayNight: 0 } : h,
          ava: shift.isAVAShift ? h : { day: 0, night: 0, holidayDay: 0, holidayNight: 0 },
          patients: (autoCalculatePatients && !shift.isAVAShift) ? h : (shift.isAVAShift ? { day: 0, night: 0, holidayDay: 0, holidayNight: 0 } : prev.patients),
          applyPatients: shift.isAVAShift ? false : prev.applyPatients
        };
      });
    };

    calculateDistribution();
  }, [shift.startTime, shift.endTime, shift.isHolidayStart, shift.isHolidayEnd, shift.isAVAShift, autoCalculatePatients, rates.payroll.nightShiftStart]);

  // --- Actions ---
  const startNewPeriod = async () => {
    if (!user) return;
    if (!newPeriodData.startDate || !newPeriodData.endDate) {
      alert('Por favor, ingresa las fechas de inicio y fin.');
      return;
    }

    const periodId = crypto.randomUUID();
    const newPeriod: BillingPeriod = {
      id: periodId,
      userId: user.uid,
      name: newPeriodData.name || `Periodo ${newPeriodData.startDate} - ${newPeriodData.endDate}`,
      startDate: newPeriodData.startDate,
      endDate: newPeriodData.endDate,
      status: 'active',
      createdAt: new Date().toISOString()
    };

    const path = `users/${user.uid}/periods/${periodId}`;
    try {
      // If there's an active period, archive it first and save its final gross
      if (activePeriod) {
        await updateDoc(doc(db, `users/${user.uid}/periods/${activePeriod.id}`), { 
          status: 'archived',
          totalGross: results.gross
        });
      }
      
      await setDoc(doc(db, path), newPeriod);
      setSelectedPeriodId(periodId);
      setShowPeriodModal(false);
      setNewPeriodData({ name: '', startDate: '', endDate: '' });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  };

  const addRecord = async () => {
    if (!user) return;
    if (!selectedPeriodId) {
      alert('Por favor, inicia un periodo de facturación primero.');
      setShowPeriodModal(true);
      return;
    }

    const recordId = editingId || crypto.randomUUID();
    const newRecord: ShiftRecord = {
      id: recordId,
      userId: user.uid,
      periodId: selectedPeriodId,
      date: shift.date,
      startTime: shift.startTime,
      endTime: shift.endTime,
      hours: { ...quantities.hours },
      ava: { ...quantities.ava },
      patients: { ...quantities.patients },
      applyPatients: quantities.applyPatients,
      isDefinitive: editingId 
        ? (viewingArchive 
            ? viewingArchive.records.find(r => r.id === editingId)?.isDefinitive 
            : records.find(r => r.id === editingId)?.isDefinitive) || false 
        : false,
    };

    if (viewingArchive) {
      // Update local archive state
      const updatedRecords = editingId 
        ? viewingArchive.records.map(r => r.id === editingId ? newRecord : r)
        : [...viewingArchive.records, newRecord];
      
      setViewingArchive({
        ...viewingArchive,
        records: sortRecords(updatedRecords)
      });
      
      // Reset form
      setEditingId(null);
      setShift({
        date: new Date().toISOString().split('T')[0],
        startTime: '07:00',
        endTime: '19:00',
        isHolidayStart: false,
        isHolidayEnd: false,
        isAVAShift: false,
      });
      setQuantities({
        hours: { day: 0, night: 0, holidayDay: 0, holidayNight: 0 },
        ava: { day: 0, night: 0, holidayDay: 0, holidayNight: 0 },
        patients: { day: 0, night: 0, holidayDay: 0, holidayNight: 0 },
        applyPatients: true,
      });
      return;
    }

    const path = `users/${user.uid}/records/${recordId}`;
    try {
      await setDoc(doc(db, path), newRecord);
      // Reset form to initial values
      setEditingId(null);
      setShift({
        date: new Date().toISOString().split('T')[0],
        startTime: '07:00',
        endTime: '19:00',
        isHolidayStart: false,
        isHolidayEnd: false,
        isAVAShift: false,
      });
      setQuantities({
        hours: { day: 0, night: 0, holidayDay: 0, holidayNight: 0 },
        ava: { day: 0, night: 0, holidayDay: 0, holidayNight: 0 },
        patients: { day: 0, night: 0, holidayDay: 0, holidayNight: 0 },
        applyPatients: true,
      });
    } catch (error) {
      handleFirestoreError(error, editingId ? OperationType.UPDATE : OperationType.CREATE, path);
    }
  };

  const removeRecord = async (id: string) => {
    if (!user) return;
    if (editingId === id) setEditingId(null);

    if (viewingArchive) {
      setViewingArchive({
        ...viewingArchive,
        records: viewingArchive.records.filter(r => r.id !== id)
      });
      return;
    }

    const path = `users/${user.uid}/records/${id}`;
    try {
      await deleteDoc(doc(db, path));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  };

  const updatePeriodTotalGross = async () => {
    if (!user || !selectedPeriodId) return;
    const period = periods.find(p => p.id === selectedPeriodId);
    if (!period) return;
    
    const path = `users/${user.uid}/periods/${selectedPeriodId}`;
    try {
      await updateDoc(doc(db, path), { totalGross: results.gross });
      alert('Total bruto del periodo actualizado con éxito.');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  };

  const updatePeriodName = async (id: string, newName: string) => {
    if (!user || !newName.trim()) return;
    const path = `users/${user.uid}/periods/${id}`;
    try {
      await updateDoc(doc(db, path), { name: newName.trim() });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  };

  const reactivatePeriod = async (id: string) => {
    if (!user) return;
    try {
      // Archive current active period if any
      if (activePeriod && activePeriod.id !== id) {
        await updateDoc(doc(db, `users/${user.uid}/periods/${activePeriod.id}`), { status: 'archived' });
      }
      // Reactivate target period
      await updateDoc(doc(db, `users/${user.uid}/periods/${id}`), { status: 'active' });
      setSelectedPeriodId(id);
      alert('Periodo reactivado con éxito.');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}/periods/${id}`);
    }
  };

  const toggleRecordStatus = async (id: string) => {
    if (!user) return;

    const baseRecords = viewingArchive ? viewingArchive.records : records;
    const record = baseRecords.find(r => r.id === id);
    if (!record) return;

    // Validation: Check if modified from original projection
    // We assume the user wants to know if they manually changed hours or patients
    // compared to what the system would calculate automatically for that shift.
    const autoDist = calculateShiftDistribution({
      startTime: record.startTime,
      endTime: record.endTime,
      isHolidayStart: false, // Limitation: we don't store holiday status in record
      isHolidayEnd: false    // but we can check if the hours match ANY holiday combination
    }, rates);

    // Simplified check: if it's already definitive, we just toggle back.
    // If it's projection, we might want to warn if it's "modified".
    // For now, we'll just implement the toggle as requested but with the logic ready.

    if (viewingArchive) {
      setViewingArchive({
        ...viewingArchive,
        records: viewingArchive.records.map(r => 
          r.id === id ? { ...r, isDefinitive: !r.isDefinitive } : r
        )
      });
      return;
    }

    const path = `users/${user.uid}/records/${id}`;
    try {
      await updateDoc(doc(db, path), { isDefinitive: !record.isDefinitive });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  };

  const editRecord = (record: ShiftRecord) => {
    setEditingId(record.id);
    setShift(prev => ({ 
      ...prev, 
      date: record.date,
      startTime: record.startTime,
      endTime: record.endTime,
      isAVAShift: Object.values(record.ava).some(v => v > 0) && Object.values(record.hours).every(v => v === 0)
    }));
    setQuantities({
      hours: { ...record.hours },
      ava: { ...record.ava },
      patients: { ...record.patients },
      applyPatients: record.applyPatients,
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const exportToCSV = () => {
    const baseRecords = viewingArchive ? viewingArchive.records : records;
    if (baseRecords.length === 0) {
      alert('No hay registros para exportar.');
      return;
    }

    const headers = [
      'Fecha', 'Inicio', 'Fin', 'Estado',
      'Horas Diu', 'Horas Noc', 'Horas F-Diu', 'Horas F-Noc',
      'AVA Diu', 'AVA Noc', 'AVA F-Diu', 'AVA F-Noc',
      'Pac Diu', 'Pac Noc', 'Pac F-Diu', 'Pac F-Noc'
    ];

    const rows = baseRecords.map(r => [
      r.date, r.startTime, r.endTime, r.isDefinitive ? 'Definitivo' : 'Proyección',
      r.hours.day, r.hours.night, r.hours.holidayDay, r.hours.holidayNight,
      r.ava.day, r.ava.night, r.ava.holidayDay, r.ava.holidayNight,
      r.applyPatients ? r.patients.day : 0, 
      r.applyPatients ? r.patients.night : 0, 
      r.applyPatients ? r.patients.holidayDay : 0, 
      r.applyPatients ? r.patients.holidayNight : 0
    ]);

    // Add summary
    rows.push([]);
    rows.push(['RESUMEN']);
    rows.push(['Total Bruto (Base)', results.gross]);
    rows.push(['Prima Proporcional', results.primaProporcional]);
    rows.push(['Vacaciones Proporcionales', results.vacacionesProporcional]);
    rows.push(['Total Devengado', results.totalGross]);
    rows.push(['Deducciones Legales', results.legalDeductions]);
    rows.push(['Deducciones Adicionales', results.additionalDeductions]);
    rows.push(['Neto a Pagar', results.net]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `extracto_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // --- Persistence Actions ---
  const exportToPDF = () => {
    const doc = new jsPDF();
    const currentPeriod = periods.find(p => p.id === selectedPeriodId);
    const periodName = currentPeriod?.name || 'Extracto de Pago';
    const userName = user?.displayName || 'Usuario';
    const userEmail = user?.email || '';

    // Header
    doc.setFontSize(20);
    doc.setTextColor(79, 70, 229); // Indigo-600
    doc.text('EXTRACTO DE NÓMINA', 105, 20, { align: 'center' });
    
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Generado el: ${new Date().toLocaleString()}`, 105, 28, { align: 'center' });

    // User & Period Info
    doc.setFontSize(12);
    doc.setTextColor(0);
    doc.text(`Colaborador: ${userName}`, 14, 45);
    doc.text(`Email: ${userEmail}`, 14, 52);
    doc.text(`Periodo: ${periodName}`, 14, 59);
    doc.text(`Fechas: ${currentPeriod?.startDate || ''} a ${currentPeriod?.endDate || ''}`, 14, 66);

    // Totals Summary Table
    autoTable(doc, {
      startY: 75,
      head: [['Concepto', 'Valor']],
      body: [
        ['Total Devengado', formatCurrency(results.totalGross)],
        ['Total Deducciones', formatCurrency(results.totalDeductions)],
        ['Neto a Recibir', formatCurrency(results.net)],
      ],
      theme: 'striped',
      headStyles: { fillColor: [79, 70, 229] },
    });

    // Income Breakdown Table
    doc.setFontSize(14);
    doc.text('Detalle de Ingresos', 14, (doc as any).lastAutoTable.finalY + 15);
    
    autoTable(doc, {
      startY: (doc as any).lastAutoTable.finalY + 20,
      head: [['Descripción', 'Valor']],
      body: [
        ['Sueldo Básico (Turnos)', formatCurrency(results.gross)],
        ['Prima Proporcional', formatCurrency(results.primaProporcional)],
        ['Cesantías Proporcionales', formatCurrency(results.cesantiasProporcional)],
        ['Intereses Cesantías', formatCurrency(results.interesesCesantias)],
        ['Vacaciones Proporcionales', formatCurrency(results.vacacionesProporcional)],
      ],
      theme: 'grid',
      headStyles: { fillColor: [16, 185, 129] }, // Emerald-500
    });

    // Deductions Breakdown Table
    doc.setFontSize(14);
    doc.text('Detalle de Deducciones', 14, (doc as any).lastAutoTable.finalY + 15);
    
    const deductionsBody = [
      ['Salud (4%)', formatCurrency(results.health)],
      ['Pensión (4%)', formatCurrency(results.pension)],
      ['ARL (0.522%)', formatCurrency(results.arl)],
      ['Caja de Compensación (4%)', formatCurrency(results.caja)],
    ];
    
    if (results.fsp > 0) deductionsBody.push(['Fondo Solidaridad Pensional', formatCurrency(results.fsp)]);
    if (results.retefuente > 0) deductionsBody.push(['Retención en la Fuente', formatCurrency(results.retefuente)]);
    if (results.additionalDeductions > 0) deductionsBody.push(['Otras Deducciones', formatCurrency(results.additionalDeductions)]);

    autoTable(doc, {
      startY: (doc as any).lastAutoTable.finalY + 20,
      head: [['Descripción', 'Valor']],
      body: deductionsBody,
      theme: 'grid',
      headStyles: { fillColor: [225, 29, 72] }, // Rose-600
    });

    // Footer
    const pageCount = (doc as any).internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(150);
      doc.text(`Página ${i} de ${pageCount} - Calculadora EMI Colombia`, 105, 285, { align: 'center' });
    }

    doc.save(`Nomina_${periodName.replace(/\s+/g, '_')}_${userName.replace(/\s+/g, '_')}.pdf`);
  };

  const saveCurrentCalculation = () => {
    const baseRecords = viewingArchive ? viewingArchive.records : records;
    if (!calcName.trim()) {
      alert('Por favor, ingresa un nombre para guardar el extracto.');
      return;
    }
    if (baseRecords.length === 0) {
      alert('No hay turnos para guardar.');
      return;
    }

    const newSaved: SavedCalculation = {
      id: crypto.randomUUID(),
      name: calcName.trim(),
      timestamp: new Date().toLocaleString(),
      records: [...baseRecords],
      rates: { ...rates },
      additionalDeductions: additionalDeductions
    };

    setSavedCalculations([newSaved, ...savedCalculations]);
    setCalcName('');
    alert('Extracto guardado con éxito.');
  };

  const loadCalculation = (saved: SavedCalculation) => {
    setViewingArchive({ ...saved });
    setRates(saved.rates);
    setAdditionalDeductions(Array.isArray(saved.additionalDeductions) ? saved.additionalDeductions : []);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const saveUpdatedArchive = () => {
    if (!viewingArchive) return;
    
    const updatedArchives = savedCalculations.map(s => 
      s.id === viewingArchive.id ? { ...viewingArchive, timestamp: new Date().toLocaleString() } : s
    );
    
    setSavedCalculations(updatedArchives);
    alert('Cambios guardados en el extracto.');
  };

  const closeArchive = () => {
    setViewingArchive(null);
    // Restore current rates and deductions from live state if needed
    // Actually, rates and deductions are shared for now, but we could restore them if we wanted.
    // For now, just returning to live records is enough.
    alert('Regresando a la bitácora en vivo.');
  };

  const deleteSavedCalculation = (id: string) => {
    if (confirm('¿Eliminar este extracto guardado?')) {
      setSavedCalculations(savedCalculations.filter(s => s.id !== id));
    }
  };

  const addDeduction = async () => {
    if (!user || !selectedPeriodId) return;
    const deductionId = crypto.randomUUID();
    const deduction: Deduction = {
      id: deductionId,
      concept: '',
      amount: 0,
      periodId: selectedPeriodId
    };
    const path = `users/${user.uid}/deductions/${deductionId}`;
    try {
      await setDoc(doc(db, path), deduction);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  };

  const updateDeduction = async (id: string, field: 'concept' | 'amount', value: string | number) => {
    if (!user) return;
    const path = `users/${user.uid}/deductions/${id}`;
    try {
      await updateDoc(doc(db, path), { [field]: value });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  };

  const removeDeduction = async (id: string) => {
    if (!user) return;
    const path = `users/${user.uid}/deductions/${id}`;
    try {
      await deleteDoc(doc(db, path));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  };

  // --- Calculations ---
  const results = useMemo(() => {
    let totalH = 0;
    let totalP = 0;
    let totalAVA = 0;

    const hoursBreakdown = { day: 0, night: 0, holidayDay: 0, holidayNight: 0 };
    const hoursValues = { day: 0, night: 0, holidayDay: 0, holidayNight: 0 };
    const avaBreakdown = { day: 0, night: 0, holidayDay: 0, holidayNight: 0 };
    const avaValues = { day: 0, night: 0, holidayDay: 0, holidayNight: 0 };
    const patientsBreakdown = { day: 0, night: 0, holidayDay: 0, holidayNight: 0 };
    const patientsValues = { day: 0, night: 0, holidayDay: 0, holidayNight: 0 };
    const monthlyHours: { [key: string]: number } = {};

    // Determine which records to use: Archive or Live
    const baseRecords = viewingArchive ? viewingArchive.records : records;

    // If editing, replace the record in the list with the current form values
    let recordsToCalculate = [...baseRecords];
    if (editingId) {
      const currentFormRecord: ShiftRecord = {
        id: editingId,
        userId: user?.uid || '',
        periodId: selectedPeriodId || undefined,
        date: shift.date,
        startTime: shift.startTime,
        endTime: shift.endTime,
        hours: { ...quantities.hours },
        ava: { ...quantities.ava },
        patients: { ...quantities.patients },
        applyPatients: quantities.applyPatients,
        isDefinitive: (viewingArchive 
          ? viewingArchive.records.find(r => r.id === editingId)?.isDefinitive 
          : records.find(r => r.id === editingId)?.isDefinitive) || false,
      };
      recordsToCalculate = recordsToCalculate.map(r => r.id === editingId ? currentFormRecord : r);
    }

    const filteredRecords = recordsToCalculate;

    filteredRecords.forEach(record => {
      // Regular Hours (Consulta)
      hoursBreakdown.day += record.hours.day;
      hoursBreakdown.night += record.hours.night;
      hoursBreakdown.holidayDay += record.hours.holidayDay;
      hoursBreakdown.holidayNight += record.hours.holidayNight;

      hoursValues.day += record.hours.day * rates.hourly.day;
      hoursValues.night += record.hours.night * rates.hourly.night;
      hoursValues.holidayDay += record.hours.holidayDay * rates.hourly.holidayDay;
      hoursValues.holidayNight += record.hours.holidayNight * rates.hourly.holidayNight;

      // AVA Hours
      avaBreakdown.day += record.ava.day;
      avaBreakdown.night += record.ava.night;
      avaBreakdown.holidayDay += record.ava.holidayDay;
      avaBreakdown.holidayNight += record.ava.holidayNight;

      avaValues.day += record.ava.day * rates.ava.day;
      avaValues.night += record.ava.night * rates.ava.night;
      avaValues.holidayDay += record.ava.holidayDay * rates.ava.holidayDay;
      avaValues.holidayNight += record.ava.holidayNight * rates.ava.holidayNight;

      totalH += 
        (record.hours.day * rates.hourly.day) +
        (record.hours.night * rates.hourly.night) +
        (record.hours.holidayDay * rates.hourly.holidayDay) +
        (record.hours.holidayNight * rates.hourly.holidayNight);
      
      totalAVA += 
        (record.ava.day * rates.ava.day) +
        (record.ava.night * rates.ava.night) +
        (record.ava.holidayDay * rates.ava.holidayDay) +
        (record.ava.holidayNight * rates.ava.holidayNight);

      const rDate = new Date(record.date + 'T00:00:00');
      const monthName = rDate.toLocaleString('es-ES', { month: 'long', year: 'numeric' });
      const recordTotalHours = record.hours.day + record.hours.night + record.hours.holidayDay + record.hours.holidayNight +
                               record.ava.day + record.ava.night + record.ava.holidayDay + record.ava.holidayNight;
      monthlyHours[monthName] = (monthlyHours[monthName] || 0) + recordTotalHours;

      if (record.applyPatients) {
        patientsBreakdown.day += record.patients.day;
        patientsBreakdown.night += record.patients.night;
        patientsBreakdown.holidayDay += record.patients.holidayDay;
        patientsBreakdown.holidayNight += record.patients.holidayNight;

        patientsValues.day += record.patients.day * rates.patient.day;
        patientsValues.night += record.patients.night * rates.patient.night;
        patientsValues.holidayDay += record.patients.holidayDay * rates.patient.holidayDay;
        patientsValues.holidayNight += record.patients.holidayNight * rates.patient.holidayNight;

        totalP += 
          (record.patients.day * rates.patient.day) +
          (record.patients.night * rates.patient.night) +
          (record.patients.holidayDay * rates.patient.holidayDay) +
          (record.patients.holidayNight * rates.patient.holidayNight);
      }
    });

    const totalMonthlyHours = hoursBreakdown.day + hoursBreakdown.night + hoursBreakdown.holidayDay + hoursBreakdown.holidayNight;
    const totalMonthlyAVA = avaBreakdown.day + avaBreakdown.night + avaBreakdown.holidayDay + avaBreakdown.holidayNight;
    const totalMonthlyPatients = patientsBreakdown.day + patientsBreakdown.night + patientsBreakdown.holidayDay + patientsBreakdown.holidayNight;

    const gross = totalH + totalP + totalAVA;
    // IBC is capped at 25 SMMLV and should be at least 1 SMMLV if there is income
    const ibc = gross > 0 ? Math.max(Math.min(gross, SMMLV_2026 * 25), SMMLV_2026) : 0;

    const health = ibc * 0.04;
    const pension = ibc * 0.04;
    const arl = ibc * 0.00522; // Riesgo 1 (0.522%)
    const caja = ibc * 0.04; // Caja de Compensación (4%) - Aunque suele ser del empleador, algunos usuarios lo incluyen
    
    let fsp = 0;
    if (ibc >= SMMLV_2026 * 4) {
      if (ibc < SMMLV_2026 * 16) fsp = ibc * 0.01;
      else if (ibc < SMMLV_2026 * 17) fsp = ibc * 0.012;
      else if (ibc < SMMLV_2026 * 18) fsp = ibc * 0.014;
      else if (ibc < SMMLV_2026 * 19) fsp = ibc * 0.016;
      else if (ibc < SMMLV_2026 * 20) fsp = ibc * 0.018;
      else fsp = ibc * 0.02;
    }

    const sumAdditionalDeductions = additionalDeductions.reduce((sum, d) => sum + d.amount, 0);
    const legalDeductions = health + pension + fsp + arl;

    // --- Proportional Calculations based on Period History ---
    const currentPeriod = periods.find(p => p.id === selectedPeriodId);
    const otherPeriods = periods.filter(p => p.id !== selectedPeriodId && p.endDate < (currentPeriod?.startDate || ''));
    const sortedOthers = [...otherPeriods].sort((a, b) => b.endDate.localeCompare(a.endDate));
    
    // Average of last 6 months including current for Prima and Cesantías
    const last5Others = sortedOthers.slice(0, 5);
    const total6 = last5Others.reduce((sum, p) => sum + (p.totalGross || 0), 0) + gross;
    const count6 = last5Others.length + 1;
    const avg6 = total6 / count6;
    
    const primaProporcional = avg6 / 12;
    const cesantiasProporcional = avg6 / 12;
    const interesesCesantias = cesantiasProporcional * 0.12;

    // Vacaciones Proporcionales (Average of last 12 months including current)
    const last11Others = sortedOthers.slice(0, 11);
    const total12 = last11Others.reduce((sum, p) => sum + (p.totalGross || 0), 0) + gross;
    const count12 = last11Others.length + 1;
    const avg12 = total12 / count12;
    const vacacionesProporcional = avg12 / 24;

    // --- Retefuente Calculation (Procedimiento 1 - Art. 383, 387, 388 ET) ---
    const uvt = rates.payroll.uvtValue;
    // Primas and Vacations are usually not part of the monthly taxable base for Retefuente
    const totalIncomeForTax = gross; 
    
    // 1. Ingresos No Constitutivos de Renta (Legal deductions: Health, Pension, FSP)
    const netIncome = totalIncomeForTax - legalDeductions;
    
    // 2. Deducciones (Art. 387)
    const dedDependents = rates.payroll.dependents ? Math.min(totalIncomeForTax * 0.1, 32 * uvt) : 0;
    const dedPrepagada = Math.min(rates.payroll.prepagada, 16 * uvt);
    const dedInteresesVivienda = Math.min(rates.payroll.interesesVivienda, 100 * uvt);
    
    // 3. Rentas Exentas (Art. 126-1, 126-4)
    const dedPensionVol = Math.min(rates.payroll.pensionVoluntaria, totalIncomeForTax * 0.3, 3800 * uvt / 12);
    
    // 4. Subtotal for 25% Exemption
    const subtotalForExempt25 = netIncome - dedDependents - dedPrepagada - dedInteresesVivienda - dedPensionVol;
    const exempt25 = Math.min(subtotalForExempt25 * 0.25, 65.8 * uvt);
    
    // 5. Total Deductions + Exemptions
    const totalDeductionsAndExemptions = dedDependents + dedPrepagada + dedInteresesVivienda + dedPensionVol + exempt25;
    
    // 6. Apply 40% Cap (Art. 388)
    // The cap is 40% of Net Income, but also capped at 1340 UVT/year (111.6 UVT/month)
    const cap40Percent = Math.min(netIncome * 0.4, 111.6 * uvt);
    const finalDeductionsAndExemptions = Math.min(totalDeductionsAndExemptions, cap40Percent);
    
    // 7. Taxable Base
    const baseGravableFinal = netIncome - finalDeductionsAndExemptions;
    const baseUVT = baseGravableFinal / uvt;
    
    let retefuente = 0;
    if (baseUVT > 95) {
      if (baseUVT <= 150) retefuente = (baseUVT - 95) * 0.19 * uvt;
      else if (baseUVT <= 360) retefuente = ((baseUVT - 150) * 0.28 + 10) * uvt;
      else if (baseUVT <= 640) retefuente = ((baseUVT - 360) * 0.33 + 69) * uvt;
      else if (baseUVT <= 945) retefuente = ((baseUVT - 640) * 0.35 + 162) * uvt;
      else if (baseUVT <= 2300) retefuente = ((baseUVT - 945) * 0.37 + 268) * uvt;
      else retefuente = ((baseUVT - 2300) * 0.39 + 770) * uvt;
    }

    const totalDeductions = legalDeductions + sumAdditionalDeductions + retefuente;
    const totalGross = gross + primaProporcional + vacacionesProporcional + cesantiasProporcional + interesesCesantias;
    const net = totalGross - totalDeductions;

    // Calculate effective deduction rate for per-shift net display
    const effectiveDeductionRate = totalGross > 0 ? totalDeductions / totalGross : 0;

    return {
      totalH,
      totalP,
      totalAVA,
      gross,
      totalGross,
      health,
      pension,
      arl,
      caja,
      fsp,
      retefuente,
      primaProporcional,
      vacacionesProporcional,
      cesantiasProporcional,
      interesesCesantias,
      legalDeductions,
      additionalDeductions: sumAdditionalDeductions,
      totalDeductions,
      net,
      effectiveDeductionRate,
      ibc,
      hoursBreakdown,
      hoursValues,
      avaBreakdown,
      avaValues,
      patientsBreakdown,
      patientsValues,
      totalMonthlyHours,
      totalMonthlyAVA,
      totalMonthlyPatients,
      monthlyHours
    };
  }, [records, rates, additionalDeductions, viewingArchive, shift, quantities, editingId, user, selectedPeriodId]);

  if (!isAuthReady) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white p-8 rounded-3xl shadow-xl max-w-md w-full text-center space-y-8"
        >
          <div className="w-20 h-20 bg-indigo-100 text-indigo-600 rounded-2xl flex items-center justify-center mx-auto rotate-3">
            <Calculator className="w-10 h-10" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">EMI pagos</h1>
            <p className="text-slate-500 text-sm">Gestiona tus turnos y extractos de forma segura en la nube.</p>
          </div>
          <div className="space-y-4">
            <div className="p-4 bg-amber-50 border border-amber-100 rounded-2xl text-amber-800 text-sm">
              <p className="font-semibold mb-1 flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                Bloqueo de terceros detectado
              </p>
              <p className="opacity-90">
                Tu navegador está bloqueando las cookies de terceros, lo que impide el inicio de sesión dentro de esta ventana.
              </p>
              <a 
                href={window.location.href} 
                target="_blank" 
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-2 font-bold text-amber-900 hover:underline"
              >
                Abrir en una pestaña nueva <ExternalLink className="w-4 h-4" />
              </a>
            </div>

            {authError && (
              <div className="p-3 bg-rose-50 text-rose-600 text-xs rounded-xl flex items-center gap-2 border border-rose-100">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <p className="text-left">{authError}</p>
              </div>
            )}
            <button 
              onClick={handleLogin}
              disabled={isLoggingIn}
              className={`w-full py-4 flex items-center justify-center gap-3 bg-white border-2 border-slate-100 rounded-2xl font-bold text-slate-700 transition-all shadow-sm ${isLoggingIn ? 'opacity-50 cursor-not-allowed' : 'hover:bg-slate-50 hover:border-indigo-100'}`}
            >
              {isLoggingIn ? (
                <div className="w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
              ) : (
                <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-5 h-5" />
              )}
              {isLoggingIn ? "Iniciando sesión..." : "Continuar con Google"}
            </button>
            <p className="text-[10px] text-slate-400">
              Al continuar, tus datos se guardarán automáticamente en tu cuenta personal.
            </p>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 font-sans selection:bg-indigo-100">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-600 p-2 rounded-xl shadow-lg shadow-indigo-200">
            <Stethoscope className="text-white w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-800">EMI pagos</h1>
            <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">Colombia 2026 • Jornada Legal</p>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="hidden sm:flex items-center gap-3 px-3 py-1.5 bg-slate-50 rounded-xl border border-slate-100">
            <img src={user.photoURL || ''} alt={user.displayName || ''} className="w-6 h-6 rounded-full" />
            <span className="text-xs font-bold text-slate-600">{user.displayName}</span>
          </div>
          <button 
            onClick={logout}
            className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all"
            title="Cerrar sesión"
          >
            <LogOut className="w-5 h-5" />
          </button>
          <button 
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="lg:hidden p-2 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <Settings className="w-5 h-5 text-slate-600" />
          </button>
        </div>
      </header>

      {/* Archive Viewing Banner */}
      {viewingArchive && (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-3 flex items-center justify-between sticky top-[73px] z-20">
          <div className="flex items-center gap-3">
            <div className="bg-amber-100 p-1.5 rounded-lg">
              <FolderOpen className="text-amber-600 w-4 h-4" />
            </div>
            <div>
              <p className="text-[10px] font-bold text-amber-600 uppercase tracking-wider">Viendo Extracto Guardado</p>
              <h2 className="text-sm font-bold text-amber-900">{viewingArchive.name}</h2>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={saveUpdatedArchive}
              className="px-4 py-1.5 bg-amber-600 text-white text-xs font-bold rounded-lg hover:bg-amber-700 transition-all flex items-center gap-2 shadow-sm"
            >
              <Save className="w-3 h-3" />
              Guardar Cambios
            </button>
            <button 
              onClick={closeArchive}
              className="px-4 py-1.5 bg-white border border-amber-200 text-amber-700 text-xs font-bold rounded-lg hover:bg-amber-100 transition-all flex items-center gap-2"
            >
              <X className="w-3 h-3" />
              Cerrar y Volver a Bitácora
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col lg:flex-row">
        {/* Sidebar: Configuration */}
        <aside className={`
          ${isSidebarOpen ? 'w-full lg:w-80' : 'w-0 overflow-hidden'} 
          bg-white border-r border-slate-200 transition-all duration-300 ease-in-out
          lg:sticky lg:top-[73px] lg:h-[calc(100vh-73px)] overflow-y-auto
        `}>
          <div className="p-6 space-y-8">
            {/* Period Selector */}
            <section className="bg-indigo-50 p-4 rounded-2xl border border-indigo-100">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-indigo-700">
                  <Calendar className="w-4 h-4" />
                  <h2 className="text-xs font-bold uppercase tracking-widest">Periodos</h2>
                </div>
                <button 
                  onClick={() => setShowPeriodModal(true)}
                  className="p-1.5 bg-white text-indigo-600 rounded-lg hover:bg-indigo-100 transition-colors shadow-sm"
                  title="Nuevo Periodo"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
              
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-[9px] font-bold text-indigo-400 uppercase ml-1">Periodo Activo</label>
                  {activePeriod ? (
                    <div 
                      onClick={() => setSelectedPeriodId(activePeriod.id)}
                      className={`p-3 rounded-xl border cursor-pointer transition-all ${selectedPeriodId === activePeriod.id ? 'bg-white border-indigo-300 shadow-sm' : 'bg-indigo-100/50 border-transparent hover:bg-white'}`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-bold text-slate-700">{activePeriod.name}</span>
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      </div>
                      <div className="text-[9px] text-slate-500 font-medium">{activePeriod.startDate} al {activePeriod.endDate}</div>
                    </div>
                  ) : (
                    <button 
                      onClick={() => setShowPeriodModal(true)}
                      className="w-full py-3 bg-white border border-dashed border-indigo-200 text-indigo-600 text-xs font-bold rounded-xl hover:bg-indigo-100 transition-all flex items-center justify-center gap-2"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Iniciar Periodo
                    </button>
                  )}
                </div>

                {periods.filter(p => p.status === 'archived').length > 0 && (
                  <div className="space-y-1">
                    <label className="text-[9px] font-bold text-slate-400 uppercase ml-1">Historial</label>
                    <select 
                      value={selectedPeriodId && periods.find(p => p.id === selectedPeriodId)?.status === 'archived' ? selectedPeriodId : ''}
                      onChange={(e) => setSelectedPeriodId(e.target.value)}
                      className="w-full bg-white border border-indigo-200 rounded-xl py-2 px-3 text-xs font-bold text-slate-700 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                    >
                      <option value="" disabled>Ver historial...</option>
                      {periods.filter(p => p.status === 'archived').map(p => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </section>

            <section>
              <div className="flex items-center gap-2 mb-4 text-indigo-600">
                <Settings className="w-4 h-4" />
                <h2 className="text-sm font-bold uppercase tracking-widest">Valores de Contrato</h2>
              </div>
              <p className="text-xs text-slate-500 mb-6 leading-relaxed">Configura las tarifas acordadas por hora y por paciente según tu contrato.</p>

              <div className="space-y-6">
                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Valor de las Horas ($)</h3>
                  <div className="space-y-4">
                    {[
                      { label: 'Diurna Consulta', key: 'day' },
                      { label: 'Nocturna Consulta', key: 'night' },
                      { label: 'Diurna Festiva', key: 'holidayDay' },
                      { label: 'Nocturna Festiva', key: 'holidayNight' },
                    ].map((item) => (
                      <div key={item.key}>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">{item.label}</label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                          <input 
                            type="number"
                            step="0.01"
                            value={rates.hourly[item.key as keyof Rates['hourly']]}
                            onChange={(e) => setRates({
                              ...rates,
                              hourly: { ...rates.hourly, [item.key]: Number(e.target.value) }
                            })}
                            className="w-full bg-white border border-slate-200 rounded-xl py-2 pl-7 pr-3 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all font-mono"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Valor Horas AVA ($)</h3>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-[10px] font-bold text-indigo-500 uppercase mb-1">Base AVA (Diurna)</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                        <input 
                          type="number"
                          step="0.01"
                          value={rates.ava.day}
                          onChange={(e) => {
                            const base = Number(e.target.value);
                            setRates({
                              ...rates,
                              ava: {
                                day: base,
                                night: Number((base * 1.35).toFixed(2)),
                                holidayDay: Number((base * 1.75).toFixed(2)),
                                holidayNight: Number((base * 2.1).toFixed(2)),
                              }
                            });
                          }}
                          className="w-full bg-white border border-indigo-200 rounded-xl py-2 pl-7 pr-3 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all font-mono font-bold"
                        />
                      </div>
                      <p className="text-[9px] text-slate-400 mt-1 italic">Calcula recargos de ley automáticamente</p>
                    </div>

                    <div className="h-px bg-slate-200 my-2" />

                    {[
                      { label: 'AVA Diurna', key: 'day' },
                      { label: 'AVA Nocturna (+35%)', key: 'night' },
                      { label: 'AVA D-Festiva (+75%)', key: 'holidayDay' },
                      { label: 'AVA N-Festiva (+110%)', key: 'holidayNight' },
                    ].map((item) => (
                      <div key={item.key}>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">{item.label}</label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                          <input 
                            type="number"
                            step="0.01"
                            value={rates.ava[item.key as keyof Rates['ava']]}
                            onChange={(e) => setRates({
                              ...rates,
                              ava: { ...rates.ava, [item.key]: Number(e.target.value) }
                            })}
                            className="w-full bg-white border border-slate-200 rounded-xl py-2 pl-7 pr-3 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all font-mono"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Valor por Pacientes ($)</h3>
                  <div className="space-y-4">
                    {[
                      { label: 'Paciente Diurno', key: 'day' },
                      { label: 'Paciente Nocturno', key: 'night' },
                      { label: 'Paciente D-Festivo', key: 'holidayDay' },
                      { label: 'Paciente N-Festivo', key: 'holidayNight' },
                    ].map((item) => (
                      <div key={item.key}>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">{item.label}</label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                          <input 
                            type="number"
                            step="0.01"
                            value={rates.patient[item.key as keyof Rates['patient']]}
                            onChange={(e) => setRates({
                              ...rates,
                              patient: { ...rates.patient, [item.key]: Number(e.target.value) }
                            })}
                            className="w-full bg-white border border-slate-200 rounded-xl py-2 pl-7 pr-3 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all font-mono"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Deducciones Adicionales ($)</h3>
                    <button 
                      onClick={addDeduction}
                      className="p-1.5 bg-indigo-100 text-indigo-600 rounded-lg hover:bg-indigo-200 transition-colors"
                      title="Agregar concepto de deducción"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  
                  <div className="space-y-4">
                    {additionalDeductions.length === 0 ? (
                      <p className="text-[10px] text-slate-400 italic text-center py-2">No hay deducciones adicionales registradas</p>
                    ) : (
                      additionalDeductions.map((deduction) => (
                        <div key={deduction.id} className="p-3 bg-white border border-slate-200 rounded-xl space-y-2 relative group">
                          <button 
                            onClick={() => removeDeduction(deduction.id)}
                            className="absolute -top-2 -right-2 w-5 h-5 bg-rose-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                          >
                            <X className="w-3 h-3" />
                          </button>
                          
                          <div>
                            <label className="block text-[9px] font-bold text-slate-400 uppercase mb-1">Concepto</label>
                            <input 
                              type="text"
                              value={deduction.concept}
                              onChange={(e) => updateDeduction(deduction.id, 'concept', e.target.value)}
                              placeholder="Ej: Cooperativa"
                              className="w-full bg-slate-50 border border-slate-100 rounded-lg py-1.5 px-3 text-xs focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                            />
                          </div>
                          
                          <div>
                            <label className="block text-[9px] font-bold text-slate-400 uppercase mb-1">Monto</label>
                            <div className="relative">
                              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-[10px]">$</span>
                              <input 
                                type="number"
                                value={deduction.amount}
                                onChange={(e) => updateDeduction(deduction.id, 'amount', Number(e.target.value))}
                                className="w-full bg-slate-50 border border-slate-100 rounded-lg py-1.5 pl-5 pr-3 text-xs focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-mono"
                              />
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Parámetros de Extracto de Pagos (Indefinido)</h3>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1 flex items-center gap-1">
                        Valor UVT 2026
                        <span title="Unidad de Valor Tributario para el año 2026 (estimado)"><Info className="w-3 h-3 text-slate-400" /></span>
                      </label>
                      <input 
                        type="number"
                        value={rates.payroll.uvtValue}
                        onChange={(e) => setRates({
                          ...rates,
                          payroll: { ...rates.payroll, uvtValue: Number(e.target.value) }
                        })}
                        className="w-full bg-white border border-slate-200 rounded-xl py-2 px-3 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-mono"
                      />
                    </div>
                    <div className="flex items-center justify-between p-3 bg-white border border-slate-200 rounded-xl">
                      <div className="flex flex-col">
                        <label className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-1">
                          Día de Corte de Facturación
                          <span title="Día del mes en que se cierra el periodo de pago (ej: el 20 de cada mes)"><Info className="w-3 h-3 text-slate-400" /></span>
                        </label>
                        <span className="text-[10px] text-slate-400">Reinicia el periodo mensual</span>
                      </div>
                      <input 
                        type="number"
                        min="1"
                        max="31"
                        value={rates.payroll.billingCutoffDay}
                        onChange={(e) => setRates({
                          ...rates,
                          payroll: { ...rates.payroll, billingCutoffDay: Number(e.target.value) }
                        })}
                        className="w-16 bg-slate-50 border border-slate-200 rounded-lg py-1 px-2 text-xs text-right focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-mono"
                      />
                    </div>
                    <div className="flex items-center justify-between p-3 bg-white border border-slate-200 rounded-xl">
                      <div className="flex flex-col">
                        <label className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-1">
                          ¿Tiene Dependientes?
                          <span title="Deducción del 10% del ingreso bruto (máx 32 UVT) por personas a cargo"><Info className="w-3 h-3 text-slate-400" /></span>
                        </label>
                        <span className="text-[10px] text-slate-400">Aplica deducción del 10%</span>
                      </div>
                      <input 
                        type="checkbox"
                        checked={rates.payroll.dependents}
                        onChange={(e) => setRates({
                          ...rates,
                          payroll: { ...rates.payroll, dependents: e.target.checked }
                        })}
                        className="w-5 h-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                    </div>
                    <div className="flex items-center justify-between p-3 bg-white border border-slate-200 rounded-xl">
                      <div className="flex flex-col">
                        <label className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-1">
                          Inicio Hora Nocturna
                          <span title="Hora en que comienza el recargo nocturno (ej: 19 para las 7 PM)"><Info className="w-3 h-3 text-slate-400" /></span>
                        </label>
                        <span className="text-[10px] text-slate-400">Formato 24h (ej: 19 = 7 PM)</span>
                      </div>
                      <input 
                        type="number"
                        min="0"
                        max="23"
                        value={rates.payroll.nightShiftStart}
                        onChange={(e) => setRates({
                          ...rates,
                          payroll: { ...rates.payroll, nightShiftStart: Number(e.target.value) }
                        })}
                        className="w-16 bg-slate-50 border border-slate-200 rounded-lg py-1 px-2 text-xs text-right focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1 flex items-center gap-1">
                        Medicina Prepagada ($)
                        <span title="Pagos mensuales por salud prepagada (máx 16 UVT)"><Info className="w-3 h-3 text-slate-400" /></span>
                      </label>
                      <input 
                        type="number"
                        value={rates.payroll.prepagada}
                        onChange={(e) => setRates({
                          ...rates,
                          payroll: { ...rates.payroll, prepagada: Number(e.target.value) }
                        })}
                        className="w-full bg-white border border-slate-200 rounded-xl py-2 px-3 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1 flex items-center gap-1">
                        Intereses de Vivienda ($)
                        <span title="Intereses pagados por crédito de vivienda o leasing habitacional (máx 100 UVT)"><Info className="w-3 h-3 text-slate-400" /></span>
                      </label>
                      <input 
                        type="number"
                        value={rates.payroll.interesesVivienda}
                        onChange={(e) => setRates({
                          ...rates,
                          payroll: { ...rates.payroll, interesesVivienda: Number(e.target.value) }
                        })}
                        className="w-full bg-white border border-slate-200 rounded-xl py-2 px-3 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1 flex items-center gap-1">
                        Pensión Voluntaria ($)
                        <span title="Aportes a pensiones voluntarias o AFC (máx 30% ingreso)"><Info className="w-3 h-3 text-slate-400" /></span>
                      </label>
                      <input 
                        type="number"
                        value={rates.payroll.pensionVoluntaria}
                        onChange={(e) => setRates({
                          ...rates,
                          payroll: { ...rates.payroll, pensionVoluntaria: Number(e.target.value) }
                        })}
                        className="w-full bg-white border border-slate-200 rounded-xl py-2 px-3 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-mono"
                      />
                    </div>
                    <div className="h-px bg-slate-200 my-2" />
                    <div>
                      <label className="block text-[10px] font-bold text-indigo-500 uppercase mb-1 flex items-center gap-1">
                        Promedio Facturado 12 Meses ($)
                        <span title="Promedio de lo facturado en los últimos 12 meses para el cálculo proporcional de vacaciones"><Info className="w-3 h-3 text-indigo-400" /></span>
                      </label>
                      <input 
                        type="number"
                        value={rates.payroll.avgBilling12Months}
                        onChange={(e) => setRates({
                          ...rates,
                          payroll: { ...rates.payroll, avgBilling12Months: Number(e.target.value) }
                        })}
                        className="w-full bg-white border border-indigo-100 rounded-xl py-2 px-3 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-indigo-500 uppercase mb-1 flex items-center gap-1">
                        Promedio Facturado 6 Meses ($)
                        <span title="Promedio de lo facturado en los últimos 6 meses para el cálculo proporcional de la prima (medio sueldo)"><Info className="w-3 h-3 text-indigo-400" /></span>
                      </label>
                      <input 
                        type="number"
                        value={rates.payroll.avgBilling6Months}
                        onChange={(e) => setRates({
                          ...rates,
                          payroll: { ...rates.payroll, avgBilling6Months: Number(e.target.value) }
                        })}
                        className="w-full bg-white border border-indigo-100 rounded-xl py-2 px-3 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-mono"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section className="pt-6 border-t border-slate-100">
              <div className="flex items-center gap-2 mb-4 text-indigo-600">
                <FolderOpen className="w-4 h-4" />
                <h2 className="text-sm font-bold uppercase tracking-widest">Extractos Guardados</h2>
              </div>
              
              {savedCalculations.length === 0 ? (
                <div className="bg-slate-50 p-4 rounded-2xl border border-dashed border-slate-200 text-center">
                  <p className="text-[10px] text-slate-400 uppercase font-bold">No hay guardadas</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {savedCalculations.map((saved) => (
                    <div 
                      key={saved.id}
                      className="group bg-white border border-slate-200 rounded-2xl p-3 hover:border-indigo-300 hover:shadow-sm transition-all cursor-pointer"
                      onClick={() => loadCalculation(saved)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <FileText className="w-3 h-3 text-slate-400 shrink-0" />
                          <span className="text-xs font-bold text-slate-700 truncate">{saved.name}</span>
                        </div>
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteSavedCalculation(saved.id);
                          }}
                          className="p-1 text-slate-300 hover:text-rose-500 transition-colors"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                      <div className="mt-1 text-[9px] text-slate-400 font-medium">{saved.timestamp}</div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 p-6 lg:p-10 space-y-10 max-w-5xl mx-auto">
          {/* Step 2: Period and Register Shift */}
          <section className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-slate-800 text-white flex items-center justify-center font-bold text-sm">2</div>
              <h2 className="text-xl font-bold text-slate-800">Periodo y Registro de Turnos</h2>
            </div>

            {/* Period Status Banner */}
            {selectedPeriodId && (
              <div className={`p-6 rounded-3xl border shadow-sm flex flex-col md:flex-row items-center justify-between gap-4 ${
                periods.find(p => p.id === selectedPeriodId)?.status === 'active' 
                  ? 'bg-white border-slate-200' 
                  : 'bg-amber-50 border-amber-200'
              }`}>
                <div className="flex items-center gap-4">
                  <div className={`p-3 rounded-2xl ${
                    periods.find(p => p.id === selectedPeriodId)?.status === 'active' 
                      ? 'bg-indigo-100 text-indigo-600' 
                      : 'bg-amber-100 text-amber-600'
                  }`}>
                    <Calendar className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <input 
                        type="text"
                        defaultValue={periods.find(p => p.id === selectedPeriodId)?.name}
                        onBlur={(e) => updatePeriodName(selectedPeriodId, e.target.value)}
                        className="text-lg font-bold text-slate-800 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-indigo-500 focus:ring-0 outline-none transition-all px-1"
                      />
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                        periods.find(p => p.id === selectedPeriodId)?.status === 'active' 
                          ? 'bg-emerald-100 text-emerald-700' 
                          : 'bg-amber-200 text-amber-800'
                      }`}>
                        {periods.find(p => p.id === selectedPeriodId)?.status === 'active' ? 'Activo' : 'Archivado'}
                      </span>
                    </div>
                    <p className="text-sm text-slate-500">
                      Rango: <span className="font-bold">{periods.find(p => p.id === selectedPeriodId)?.startDate}</span> al <span className="font-bold">{periods.find(p => p.id === selectedPeriodId)?.endDate}</span>
                    </p>
                  </div>
                </div>

                {periods.find(p => p.id === selectedPeriodId)?.status === 'active' ? (
                  <button 
                    onClick={() => setShowPeriodModal(true)}
                    className="px-5 py-2.5 bg-slate-800 text-white text-xs font-bold rounded-xl hover:bg-slate-700 transition-all flex items-center gap-2 shadow-md"
                  >
                    <Archive className="w-4 h-4" />
                    Cerrar y Nuevo Periodo
                  </button>
                ) : (
                  <div className="flex flex-col md:flex-row items-center gap-3 bg-white/50 p-3 rounded-2xl border border-amber-200/50">
                    <div className="flex items-center gap-2">
                      <Info className="w-4 h-4 text-amber-600" />
                      <p className="text-xs text-amber-800 font-medium">Este periodo está archivado.</p>
                    </div>
                    <button 
                      onClick={() => reactivatePeriod(selectedPeriodId)}
                      className="px-4 py-2 bg-indigo-600 text-white text-[10px] font-bold rounded-xl hover:bg-indigo-700 transition-all flex items-center gap-2 shadow-sm"
                    >
                      <RotateCcw className="w-3 h-3" />
                      Reactivar Periodo
                    </button>
                    <button 
                      onClick={updatePeriodTotalGross}
                      className="px-4 py-2 bg-amber-600 text-white text-[10px] font-bold rounded-xl hover:bg-amber-700 transition-all flex items-center gap-2 shadow-sm"
                    >
                      <Save className="w-3 h-3" />
                      Actualizar Cierre
                    </button>
                  </div>
                )}
              </div>
            )}
            
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-6">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 text-indigo-600">
                  <FilePlus className="w-5 h-5" />
                  <h3 className="text-sm font-bold uppercase tracking-wider">Registrar Turno</h3>
                </div>
              </div>
              <div className="flex items-start gap-3 bg-blue-50 p-4 rounded-2xl text-blue-700 text-sm leading-relaxed">
                <Info className="w-5 h-5 shrink-0 mt-0.5" />
                <p>Configura los intervalos. Las horas se calcularán automáticamente, pero puedes ajustarlas antes de agregarlas a la bitácora.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">Fecha</label>
                  <input 
                    type="date" 
                    value={shift.date}
                    onChange={(e) => setShift({ ...shift, date: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                  />
                </div>

                <div className="space-y-2">
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">Hora de Inicio (24h)</label>
                  <input 
                    type="time" 
                    value={shift.startTime}
                    onChange={(e) => setShift({ ...shift, startTime: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                  />
                  <label className="flex items-center gap-2 cursor-pointer group">
                    <input 
                      type="checkbox" 
                      checked={shift.isHolidayStart}
                      onChange={(e) => setShift({ ...shift, isHolidayStart: e.target.checked })}
                      className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-xs text-slate-600 group-hover:text-slate-900 transition-colors">¿Inicio en Festivo?</span>
                  </label>
                </div>

                <div className="space-y-2">
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">Hora de Fin (24h)</label>
                  <input 
                    type="time" 
                    value={shift.endTime}
                    onChange={(e) => setShift({ ...shift, endTime: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                  />
                  <label className="flex items-center gap-2 cursor-pointer group">
                    <input 
                      type="checkbox" 
                      checked={shift.isHolidayEnd}
                      onChange={(e) => setShift({ ...shift, isHolidayEnd: e.target.checked })}
                      className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-xs text-slate-600 group-hover:text-slate-900 transition-colors">¿Fin en Festivo?</span>
                  </label>
                </div>

                <div className="lg:col-span-2 flex flex-col justify-center bg-slate-50 rounded-2xl border border-dashed border-slate-200 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Distribución de Horas</span>
                    <label className="flex items-center gap-2 cursor-pointer bg-indigo-50 px-2 py-1 rounded-lg border border-indigo-100">
                      <input 
                        type="checkbox" 
                        checked={shift.isAVAShift}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setShift({ ...shift, isAVAShift: checked });
                          if (checked) {
                            setQuantities(prev => ({ 
                              ...prev, 
                              applyPatients: false,
                              patients: { day: 0, night: 0, holidayDay: 0, holidayNight: 0 }
                            }));
                          }
                        }}
                        className="w-3 h-3 rounded border-indigo-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className="text-[10px] font-bold text-indigo-600 uppercase">¿Turno AVA?</span>
                    </label>
                  </div>
                  <div className="grid grid-cols-2 gap-x-8 gap-y-2">
                    <div className="text-[10px] font-bold text-slate-400 uppercase">{shift.isAVAShift ? 'AVA ' : ''}Diurnas: <span className="text-slate-700 font-mono text-sm ml-1">{shift.isAVAShift ? quantities.ava.day : quantities.hours.day}h</span></div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase">{shift.isAVAShift ? 'AVA ' : ''}Nocturnas: <span className="text-slate-700 font-mono text-sm ml-1">{shift.isAVAShift ? quantities.ava.night : quantities.hours.night}h</span></div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase">{shift.isAVAShift ? 'AVA ' : ''}D-Fest: <span className="text-slate-700 font-mono text-sm ml-1">{shift.isAVAShift ? quantities.ava.holidayDay : quantities.hours.holidayDay}h</span></div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase">{shift.isAVAShift ? 'AVA ' : ''}N-Fest: <span className="text-slate-700 font-mono text-sm ml-1">{shift.isAVAShift ? quantities.ava.holidayNight : quantities.hours.holidayNight}h</span></div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Hours Adjustment */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-indigo-600">
                    <Clock className="w-4 h-4" />
                    <h3 className="text-sm font-bold">Ajuste de Horas</h3>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    {[
                      { label: 'Diurnas', key: 'day' },
                      { label: 'Nocturnas', key: 'night' },
                      { label: 'D-Fest', key: 'holidayDay' },
                      { label: 'N-Fest', key: 'holidayNight' },
                    ].map((item) => (
                      <div key={item.key}>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">{item.label}</label>
                        <input 
                          type="number"
                          step="0.5"
                          disabled={shift.isAVAShift}
                          value={quantities.hours[item.key as keyof Quantities['hours']]}
                          onChange={(e) => setQuantities({
                            ...quantities,
                            hours: { ...quantities.hours, [item.key]: Number(e.target.value) }
                          })}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-mono disabled:opacity-50"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {/* AVA Adjustment */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-indigo-600">
                    <TrendingUp className="w-4 h-4" />
                    <h3 className="text-sm font-bold">Ajuste Horas AVA</h3>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    {[
                      { label: 'AVA Diurnas', key: 'day' },
                      { label: 'AVA Nocturnas', key: 'night' },
                      { label: 'AVA D-Fest', key: 'holidayDay' },
                      { label: 'AVA N-Fest', key: 'holidayNight' },
                    ].map((item) => (
                      <div key={item.key}>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">{item.label}</label>
                        <input 
                          type="number"
                          step="0.5"
                          value={quantities.ava[item.key as keyof Quantities['ava']]}
                          onChange={(e) => setQuantities({
                            ...quantities,
                            ava: { ...quantities.ava, [item.key]: Number(e.target.value) }
                          })}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-mono"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Patients Adjustment */}
                <div className="flex flex-col gap-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-indigo-600">
                      <Users className="w-4 h-4" />
                      <h3 className="text-sm font-bold">Pacientes Atendidos</h3>
                    </div>
                    <div className="flex items-center gap-4">
                      <label className={`flex items-center gap-2 cursor-pointer`}>
                        <input 
                          type="checkbox" 
                          checked={autoCalculatePatients}
                          onChange={(e) => setAutoCalculatePatients(e.target.checked)}
                          className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span className="text-[10px] font-bold text-slate-500 uppercase">Auto-calcular</span>
                      </label>
                      <label className={`flex items-center gap-2 ${shift.isAVAShift ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}>
                        <input 
                          type="checkbox" 
                          checked={quantities.applyPatients}
                          disabled={shift.isAVAShift}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setQuantities(prev => ({ 
                              ...prev, 
                              applyPatients: checked,
                              patients: (checked && autoCalculatePatients) ? (shift.isAVAShift ? { ...prev.ava } : { ...prev.hours }) : prev.patients
                            }));
                          }}
                          className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span className="text-xs text-slate-600">Aplica cobro</span>
                      </label>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    {[
                      { label: 'Diurnos', key: 'day' },
                      { label: 'Nocturnos', key: 'night' },
                      { label: 'D-Fest', key: 'holidayDay' },
                      { label: 'N-Fest', key: 'holidayNight' },
                    ].map((item) => (
                      <div key={item.key}>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">{item.label}</label>
                        <input 
                          type="number"
                          disabled={!quantities.applyPatients}
                          value={quantities.patients[item.key as keyof Quantities['patients']]}
                          onChange={(e) => {
                            setAutoCalculatePatients(false);
                            setQuantities({
                              ...quantities,
                              patients: { ...quantities.patients, [item.key]: Number(e.target.value) }
                            });
                          }}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-mono disabled:opacity-50"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-4">
                {editingId && (
                  <button 
                    onClick={() => {
                      setEditingId(null);
                      setShift({
                        date: new Date().toISOString().split('T')[0],
                        startTime: '07:00',
                        endTime: '19:00',
                        isHolidayStart: false,
                        isHolidayEnd: false,
                        isAVAShift: false,
                      });
                      setQuantities({
                        hours: { day: 0, night: 0, holidayDay: 0, holidayNight: 0 },
                        ava: { day: 0, night: 0, holidayDay: 0, holidayNight: 0 },
                        patients: { day: 0, night: 0, holidayDay: 0, holidayNight: 0 },
                        applyPatients: true,
                      });
                    }}
                    className="flex-1 bg-slate-200 text-slate-700 font-bold py-4 rounded-2xl hover:bg-slate-300 transition-all"
                  >
                    Cancelar Edición
                  </button>
                )}
                <button 
                  onClick={addRecord}
                  className={`flex-[2] ${editingId ? 'bg-amber-500 hover:bg-amber-600' : 'bg-indigo-600 hover:bg-indigo-700'} text-white font-bold py-4 rounded-2xl shadow-lg transition-all flex items-center justify-center gap-2`}
                >
                  <Calculator className="w-5 h-5" />
                  {editingId ? 'Actualizar Registro' : 'Agregar a la Bitácora'}
                </button>
              </div>
            </div>
          </section>

          {/* Step 3: Log (Bitácora) */}
          <section className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-slate-800 text-white flex items-center justify-center font-bold text-sm">3</div>
                <h2 className="text-xl font-bold text-slate-800">
                  {viewingArchive ? `Extracto: ${viewingArchive.name}` : 'Bitácora de Turnos'}
                </h2>
              </div>
            </div>

            <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
              {/* Legend */}
              <div className="bg-slate-50/50 border-b border-slate-100 p-4 flex flex-wrap gap-4 justify-center">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-amber-500"></div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Diurna</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-indigo-500"></div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Nocturna</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-rose-500"></div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">D-Festiva</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-purple-500"></div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">N-Festiva</span>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="p-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Fecha</th>
                      <th className="p-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Horario</th>
                      <th className="p-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Horas Consulta</th>
                      <th className="p-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Horas AVA</th>
                      <th className="p-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Pacientes</th>
                      <th className="p-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Valor Turno (B/N)</th>
                      <th className="p-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">Estado</th>
                      <th className="p-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    <AnimatePresence initial={false}>
                      {(viewingArchive ? viewingArchive.records : records).length === 0 ? (
                        <tr>
                          <td colSpan={6} className="p-10 text-center text-slate-400 italic">No hay turnos registrados aún. Agrega tu primer turno arriba.</td>
                        </tr>
                      ) : (
                        (viewingArchive ? viewingArchive.records : records).map((record) => (
                          <motion.tr 
                            key={record.id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, x: -20 }}
                            className="hover:bg-slate-50/50 transition-colors"
                          >
                            <td className="p-4 text-sm font-medium text-slate-700">{record.date}</td>
                            <td className="p-4 text-xs font-mono text-slate-500">
                              {record.startTime} - {record.endTime === '00:00' ? '00:00 (Siguiente día)' : record.endTime}
                            </td>
                            <td className="p-4 text-xs font-mono font-bold">
                              <span className="text-amber-600">{record.hours.day}</span>
                              <span className="text-slate-300 mx-1">/</span>
                              <span className="text-indigo-600">{record.hours.night}</span>
                              <span className="text-slate-300 mx-1">/</span>
                              <span className="text-rose-600">{record.hours.holidayDay}</span>
                              <span className="text-slate-300 mx-1">/</span>
                              <span className="text-purple-600">{record.hours.holidayNight}</span>
                            </td>
                            <td className="p-4 text-xs font-mono font-bold">
                              <span className="text-amber-600">{record.ava.day}</span>
                              <span className="text-slate-300 mx-1">/</span>
                              <span className="text-indigo-600">{record.ava.night}</span>
                              <span className="text-slate-300 mx-1">/</span>
                              <span className="text-rose-600">{record.ava.holidayDay}</span>
                              <span className="text-slate-300 mx-1">/</span>
                              <span className="text-purple-600">{record.ava.holidayNight}</span>
                            </td>
                            <td className="p-4 text-xs font-mono font-bold">
                              {record.applyPatients ? (
                                <>
                                  <span className="text-amber-600">{record.patients.day}</span>
                                  <span className="text-slate-300 mx-1">/</span>
                                  <span className="text-indigo-600">{record.patients.night}</span>
                                  <span className="text-slate-300 mx-1">/</span>
                                  <span className="text-rose-600">{record.patients.holidayDay}</span>
                                  <span className="text-slate-300 mx-1">/</span>
                                  <span className="text-purple-600">{record.patients.holidayNight}</span>
                                </>
                              ) : (
                                <span className="text-slate-300 italic font-normal">No aplica</span>
                              )}
                            </td>
                            <td className="p-4 text-xs font-mono">
                              {(() => {
                                const grossShift = 
                                  (record.hours.day * rates.hourly.day) +
                                  (record.hours.night * rates.hourly.night) +
                                  (record.hours.holidayDay * rates.hourly.holidayDay) +
                                  (record.hours.holidayNight * rates.hourly.holidayNight) +
                                  (record.ava.day * rates.ava.day) +
                                  (record.ava.night * rates.ava.night) +
                                  (record.ava.holidayDay * rates.ava.holidayDay) +
                                  (record.ava.holidayNight * rates.ava.holidayNight) +
                                  (record.applyPatients ? (
                                    (record.patients.day * rates.patient.day) +
                                    (record.patients.night * rates.patient.night) +
                                    (record.patients.holidayDay * rates.patient.holidayDay) +
                                    (record.patients.holidayNight * rates.patient.holidayNight)
                                  ) : 0);
                                
                                const netShift = grossShift * (1 - results.effectiveDeductionRate);
                                
                                return (
                                  <div className="flex flex-col">
                                    <span className="font-bold text-slate-700">${Math.round(grossShift).toLocaleString()}</span>
                                    <span className="text-[10px] text-slate-400">Neto: ${Math.round(netShift).toLocaleString()}</span>
                                  </div>
                                );
                              })()}
                            </td>
                            <td className="p-4 text-center">
                              <button 
                                onClick={() => toggleRecordStatus(record.id)}
                                className={`group relative px-3 py-1.5 rounded-xl text-[10px] font-bold transition-all flex items-center gap-1.5 mx-auto ${
                                  record.isDefinitive 
                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
                                    : 'bg-amber-50 text-amber-700 border border-amber-200 hover:bg-emerald-600 hover:text-white hover:border-emerald-600'
                                }`}
                                title={record.isDefinitive ? "Confirmado" : "Click para confirmar como definitivo"}
                              >
                                {record.isDefinitive ? (
                                  <>
                                    <CheckCircle2 className="w-3 h-3" />
                                    <span>Definitivo</span>
                                  </>
                                ) : (
                                  <>
                                    <div className="w-1.5 h-1.5 rounded-full bg-amber-500 group-hover:bg-white animate-pulse" />
                                    <span>Proyección</span>
                                  </>
                                )}
                              </button>
                            </td>
                            <td className="p-4 text-right flex items-center justify-end gap-2">
                              <button 
                                onClick={() => editRecord(record)}
                                className="p-2 text-indigo-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                                title="Editar registro"
                              >
                                <Edit className="w-4 h-4" />
                              </button>
                              <button 
                                onClick={() => removeRecord(record.id)}
                                className="p-2 text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all"
                                title="Eliminar registro"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </td>
                          </motion.tr>
                        ))
                      )}
                    </AnimatePresence>
                  </tbody>
                  {(viewingArchive ? viewingArchive.records : records).length > 0 && (
                    <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                      <tr>
                        <td colSpan={2} className="p-4 text-right text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                          Totales del Periodo:
                        </td>
                        <td className="p-4 text-xs font-mono font-black text-indigo-600">
                          {results.totalMonthlyHours}h
                        </td>
                        <td className="p-4 text-xs font-mono font-black text-violet-600">
                          {results.totalMonthlyAVA}h
                        </td>
                        <td className="p-4 text-xs font-mono font-black text-emerald-600">
                          {results.totalMonthlyPatients} Pac.
                        </td>
                        <td className="p-4 text-xs font-mono font-black text-slate-800">
                          {formatCurrency(results.gross)}
                        </td>
                        <td colSpan={2}></td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          </section>

          {/* Save Calculation */}
          {(viewingArchive ? viewingArchive.records : records).length > 0 && (
            <section className="bg-indigo-50 p-6 rounded-3xl border border-indigo-100 flex flex-col md:flex-row items-center gap-4">
              <div className="flex items-center gap-3 shrink-0">
                <div className="bg-white p-2 rounded-xl shadow-sm">
                  <Save className="text-indigo-600 w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-800">Guardar Extracto</h3>
                  <p className="text-[10px] text-slate-500 uppercase font-bold">Persiste tus datos localmente</p>
                </div>
              </div>
              <div className="flex-1 w-full flex gap-2">
                <input 
                  type="text" 
                  placeholder="Nombre del extracto (ej: Marzo 2026)"
                  value={calcName}
                  onChange={(e) => setCalcName(e.target.value)}
                  className="flex-1 bg-white border border-indigo-200 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                />
                <button 
                  onClick={saveCurrentCalculation}
                  className="bg-indigo-600 text-white px-6 py-2 rounded-xl text-sm font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 flex items-center gap-2"
                >
                  <Save className="w-4 h-4" />
                  Guardar
                </button>
                <button 
                  onClick={exportToCSV}
                  className="bg-emerald-600 text-white px-6 py-2 rounded-xl text-sm font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100 flex items-center gap-2"
                >
                  <FileText className="w-4 h-4" />
                  Exportar CSV
                </button>
              </div>
            </section>
          )}

          {/* Step 4: Final Extract */}
          <section className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-slate-800 text-white flex items-center justify-center font-bold text-sm">4</div>
              <h2 className="text-xl font-bold text-slate-800">Extracto Final de Pago</h2>
            </div>
            
            {(viewingArchive ? viewingArchive.records : records).length > 0 ? (
              <div className="bg-white p-6 lg:p-10 rounded-3xl border border-slate-200 shadow-sm space-y-10">
                {/* Summary Header */}
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
                  <div className="space-y-1">
                    <h3 className="text-2xl font-bold text-slate-800">
                      {periods.find(p => p.id === selectedPeriodId)?.name || 'Extracto de Pago'}
                    </h3>
                    <p className="text-slate-500 font-medium">Resumen detallado de ingresos y deducciones legales.</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <button 
                      onClick={() => window.print()}
                      className="p-3 bg-slate-100 text-slate-600 rounded-2xl hover:bg-slate-200 transition-all"
                      title="Imprimir Extracto"
                    >
                      <Printer className="w-5 h-5" />
                    </button>
                    <button 
                      onClick={exportToPDF}
                      className="px-6 py-3 bg-emerald-600 text-white font-bold rounded-2xl hover:bg-emerald-700 transition-all flex items-center gap-2 shadow-lg shadow-emerald-200"
                    >
                      <FileDown className="w-5 h-5" />
                      Exportar PDF
                    </button>
                    <button 
                      onClick={saveCurrentCalculation}
                      className="px-6 py-3 bg-indigo-600 text-white font-bold rounded-2xl hover:bg-indigo-700 transition-all flex items-center gap-2 shadow-lg shadow-indigo-200"
                    >
                      <Save className="w-5 h-5" />
                      Guardar Extracto
                    </button>
                  </div>
                </div>

                {/* Main Totals Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="bg-emerald-50 p-6 rounded-3xl border border-emerald-100 space-y-2">
                    <div className="flex items-center gap-2 text-emerald-700">
                      <TrendingUp className="w-4 h-4" />
                      <span className="text-[10px] font-bold uppercase tracking-widest">Total Devengado</span>
                    </div>
                    <p className="text-3xl font-bold text-emerald-800">{formatCurrency(results.totalGross)}</p>
                  </div>
                <div className="bg-rose-50 p-6 rounded-3xl border border-rose-100 space-y-2">
                    <div className="flex items-center gap-2 text-rose-700">
                      <TrendingDown className="w-4 h-4" />
                      <span className="text-[10px] font-bold uppercase tracking-widest">Total Deducciones</span>
                    </div>
                    <p className="text-3xl font-bold text-rose-800">{formatCurrency(results.totalDeductions)}</p>
                    <div className="flex items-center gap-4 text-[9px] font-bold text-rose-400 uppercase tracking-widest pt-1">
                      <span>Legales: {formatCurrency(results.legalDeductions)}</span>
                      <span>Otras: {formatCurrency(results.additionalDeductions)}</span>
                    </div>
                  </div>
                  <div className="bg-indigo-600 p-6 rounded-3xl text-white space-y-2 shadow-xl shadow-indigo-100">
                    <div className="flex items-center gap-2 opacity-80">
                      <Wallet className="w-4 h-4" />
                      <span className="text-[10px] font-bold uppercase tracking-widest">Neto a Recibir</span>
                    </div>
                    <p className="text-3xl font-bold">{formatCurrency(results.net)}</p>
                  </div>
                </div>

                {/* Detailed Breakdown */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                  {/* Income Breakdown */}
                  <div className="space-y-6">
                    <div className="flex items-center gap-2 text-emerald-600">
                      <PlusCircle className="w-5 h-5" />
                      <h4 className="font-bold uppercase tracking-wider text-sm">Ingresos Detallados</h4>
                    </div>
                    <div className="space-y-4">
                      <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                        <span className="text-sm font-medium text-slate-600">Sueldo Básico (Turnos)</span>
                        <span className="font-bold text-slate-800">{formatCurrency(results.gross)}</span>
                      </div>
                      <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                        <span className="text-sm font-medium text-slate-600">Prima Proporcional</span>
                        <span className="font-bold text-slate-800">{formatCurrency(results.primaProporcional)}</span>
                      </div>
                      <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                        <span className="text-sm font-medium text-slate-600">Cesantías Proporcionales</span>
                        <span className="font-bold text-slate-800">{formatCurrency(results.cesantiasProporcional)}</span>
                      </div>
                      <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                        <span className="text-sm font-medium text-slate-600">Intereses Cesantías</span>
                        <span className="font-bold text-slate-800">{formatCurrency(results.interesesCesantias)}</span>
                      </div>
                      <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                        <span className="text-sm font-medium text-slate-600">Vacaciones Proporcionales</span>
                        <span className="font-bold text-slate-800">{formatCurrency(results.vacacionesProporcional)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Deductions Breakdown */}
                  <div className="space-y-6">
                    <div className="flex items-center gap-2 text-rose-600">
                      <MinusCircle className="w-5 h-5" />
                      <h4 className="font-bold uppercase tracking-wider text-sm">Deducciones Detalladas</h4>
                    </div>
                    <div className="space-y-4">
                      <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                        <div className="flex flex-col">
                          <span className="text-sm font-medium text-slate-600">Salud (4%)</span>
                          <span className="text-[10px] text-slate-400">IBC: {formatCurrency(results.ibc)}</span>
                        </div>
                        <span className="font-bold text-rose-700">-{formatCurrency(results.health)}</span>
                      </div>
                      <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                        <span className="text-sm font-medium text-slate-600">Pensión (4%)</span>
                        <span className="font-bold text-rose-700">-{formatCurrency(results.pension)}</span>
                      </div>
                      <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                        <span className="text-sm font-medium text-slate-600">ARL (0.522%)</span>
                        <span className="font-bold text-rose-700">-{formatCurrency(results.arl)}</span>
                      </div>
                      <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                        <span className="text-sm font-medium text-slate-600">Caja de Compensación (4%)</span>
                        <span className="font-bold text-slate-800">{formatCurrency(results.caja)}</span>
                      </div>
                      {results.fsp > 0 && (
                        <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                          <span className="text-sm font-medium text-slate-600">Fondo Solidaridad Pensional</span>
                          <span className="font-bold text-rose-700">-{formatCurrency(results.fsp)}</span>
                        </div>
                      )}
                      {results.retefuente > 0 && (
                        <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                          <span className="text-sm font-medium text-slate-600">Retención en la Fuente</span>
                          <span className="font-bold text-rose-700">-{formatCurrency(results.retefuente)}</span>
                        </div>
                      )}
                      {results.additionalDeductions > 0 && (
                        <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                          <span className="text-sm font-medium text-slate-600">Otras Deducciones</span>
                          <span className="font-bold text-rose-700">-{formatCurrency(results.additionalDeductions)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-white p-20 rounded-[40px] border border-slate-200 border-dashed text-center space-y-4">
                <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto text-slate-300">
                  <Calculator className="w-10 h-10" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-xl font-bold text-slate-800">Esperando Datos</h3>
                  <p className="text-slate-500 max-w-xs mx-auto">Agrega turnos a la bitácora para generar el extracto final de pago.</p>
                </div>
              </div>
            )}
          </section>

          {/* Step 5: Period History */}
          <section className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-slate-800 text-white flex items-center justify-center font-bold text-sm">5</div>
              <h2 className="text-xl font-bold text-slate-800">Historial de Periodos</h2>
            </div>

            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
              {periods.length === 0 ? (
                <div className="text-center py-10 space-y-4">
                  <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-400">
                    <History className="w-8 h-8" />
                  </div>
                  <p className="text-slate-500 font-medium">No hay historial de periodos registrados.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {periods.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map(p => (
                    <div 
                      key={p.id}
                      onClick={() => setSelectedPeriodId(p.id)}
                      className={`p-5 rounded-2xl border transition-all cursor-pointer group ${
                        selectedPeriodId === p.id 
                          ? 'bg-indigo-50 border-indigo-200 shadow-sm' 
                          : 'bg-slate-50 border-transparent hover:bg-white hover:border-slate-200 hover:shadow-md'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className={`p-2 rounded-xl ${p.status === 'active' ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-200 text-slate-500'}`}>
                          <Calendar className="w-4 h-4" />
                        </div>
                        <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${
                          p.status === 'active' ? 'bg-emerald-500 text-white' : 'bg-slate-300 text-slate-600'
                        }`}>
                          {p.status === 'active' ? 'Activo' : 'Archivado'}
                        </span>
                      </div>
                      <h4 className="font-bold text-slate-800 mb-1 group-hover:text-indigo-600 transition-colors">{p.name}</h4>
                      <p className="text-[10px] text-slate-500 font-medium">
                        {p.startDate} al {p.endDate}
                      </p>
                      {p.totalGross !== undefined && (
                        <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between">
                          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Total Bruto</span>
                          <span className="text-xs font-bold text-emerald-600">{formatCurrency(p.totalGross)}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </main>
      </div>

      {/* Footer Info */}
      <footer className="bg-slate-900 text-slate-400 p-10 text-center space-y-4">
        <div className="flex items-center justify-center gap-2 text-white">
          <Stethoscope className="w-5 h-5" />
          <span className="font-bold tracking-tight">EMI pagos</span>
        </div>
        <p className="text-xs max-w-md mx-auto leading-relaxed">
          Herramienta diseñada para profesionales de la salud en Colombia. 
          Cálculos basados en la normativa laboral vigente para 2026.
        </p>
        <div className="pt-4 border-t border-slate-800 text-[10px] uppercase tracking-widest">
          © 2026 • Desarrollado para el Gremio Médico
        </div>
      </footer>
      {/* Period Modal */}
      <AnimatePresence>
        {showPeriodModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl shadow-2xl max-w-md w-full overflow-hidden"
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-indigo-600 text-white">
                <div className="flex items-center gap-3">
                  <Calendar className="w-5 h-5" />
                  <h3 className="font-bold">Nuevo Periodo de Facturación</h3>
                </div>
                <button onClick={() => setShowPeriodModal(false)} className="p-1 hover:bg-white/20 rounded-lg transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="p-6 space-y-6">
                <p className="text-sm text-slate-500 leading-relaxed">
                  Al iniciar un nuevo periodo, el actual se archivará y podrás consultarlo más tarde. 
                  Indica las fechas de inicio y fin para este nuevo ciclo.
                </p>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 tracking-wider">Nombre del Periodo (Opcional)</label>
                    <input 
                      type="text"
                      placeholder="Ej: Marzo 2026"
                      value={newPeriodData.name}
                      onChange={(e) => setNewPeriodData({ ...newPeriodData, name: e.target.value })}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                    />
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 tracking-wider">Fecha Inicio</label>
                      <input 
                        type="date"
                        value={newPeriodData.startDate}
                        onChange={(e) => setNewPeriodData({ ...newPeriodData, startDate: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 tracking-wider">Fecha Fin</label>
                      <input 
                        type="date"
                        value={newPeriodData.endDate}
                        onChange={(e) => setNewPeriodData({ ...newPeriodData, endDate: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                      />
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="p-6 bg-slate-50 flex gap-3">
                <button 
                  onClick={() => setShowPeriodModal(false)}
                  className="flex-1 py-3 border border-slate-200 text-slate-600 font-bold rounded-xl hover:bg-white transition-all"
                >
                  Cancelar
                </button>
                <button 
                  onClick={startNewPeriod}
                  className="flex-1 py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200"
                >
                  Iniciar Periodo
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
