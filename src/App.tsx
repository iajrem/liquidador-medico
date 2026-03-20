/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
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
  Plus,
  X,
  LogIn,
  LogOut,
  ExternalLink,
  User as UserIcon,
  CheckCircle2 as CheckIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  auth, 
  db, 
  signInWithGoogle, 
  logout, 
  onAuthStateChanged, 
  collection, 
  doc, 
  setDoc, 
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
    dependents: number; // Max 10% of gross or 32 UVT
    prepagada: number; // Max 16 UVT
    pensionVoluntaria: number; // Max 30% of income or 3800 UVT/year
    primaPercentage: number;
    primaBaseAverage: number;
    vacationProvisionRate: number; // Usually 4.17%
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
    day: 21997.21,
    night: 29697.77,
    holidayDay: 38497.50,
    holidayNight: 46194.00,
  },
  ava: {
    day: 35541.95,
    night: 47981.16,
    holidayDay: 62199.22,
    holidayNight: 74639.48,
  },
  patient: {
    day: 10203.70,
    night: 13776.26,
    holidayDay: 17856.47,
    holidayNight: 21426.00,
  },
  payroll: {
    uvtValue: 49786, // Estimated for 2026
    dependents: 0,
    prepagada: 0,
    pensionVoluntaria: 0,
    primaPercentage: 0,
    primaBaseAverage: 0,
    vacationProvisionRate: 4.17,
  }
};

// --- Helper Functions ---

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
    } catch (error) {
      console.error("Detailed Login error:", error);
      let message = "Error al iniciar sesión. Por favor, intenta de nuevo.";
      if (error instanceof Error) {
        console.log("Error name:", error.name);
        console.log("Error message:", error.message);
        if (error.message.includes('popup-blocked')) {
          message = "El navegador bloqueó la ventana emergente. Por favor, permite las ventanas emergentes para este sitio.";
        } else if (error.message.includes('auth/unauthorized-domain')) {
          message = "Este dominio no está autorizado en la consola de Firebase. Por favor, contacta al administrador.";
        } else if (error.message.includes('auth/cancelled-popup-request')) {
          message = "La ventana de inicio de sesión se cerró antes de completar el proceso.";
        } else {
          message = `Error técnico: ${error.message}`;
        }
      }
      setAuthError(message);
    } finally {
      setIsLoggingIn(false);
      console.log("Login flow finished");
    }
  };

  // --- Firestore Sync ---
  useEffect(() => {
    if (!isAuthReady || !user) {
      setRecords([]);
      setAdditionalDeductions([]);
      return;
    }

    const recordsPath = `users/${user.uid}/records`;
    const unsubscribeRecords = onSnapshot(collection(db, recordsPath), (snapshot) => {
      const recordsData = snapshot.docs.map(doc => doc.data() as ShiftRecord);
      setRecords(recordsData.sort((a, b) => {
        const dateA = new Date(`${a.date}T${a.startTime}`).getTime();
        const dateB = new Date(`${b.date}T${b.startTime}`).getTime();
        return dateA - dateB;
      }));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, recordsPath);
    });

    const deductionsPath = `users/${user.uid}/deductions`;
    const unsubscribeDeductions = onSnapshot(collection(db, deductionsPath), (snapshot) => {
      const deductionsData = snapshot.docs.map(doc => doc.data() as Deduction);
      setAdditionalDeductions(deductionsData);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, deductionsPath);
    });

    return () => {
      unsubscribeRecords();
      unsubscribeDeductions();
    };
  }, [isAuthReady, user]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [showDetails, setShowDetails] = useState(false);
  const [savedCalculations, setSavedCalculations] = useState<SavedCalculation[]>([]);
  const [calcName, setCalcName] = useState('');

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
  useEffect(() => {
    const calculateDistribution = () => {
      const [startH, startM] = shift.startTime.split(':').map(Number);
      const [endH, endM] = shift.endTime.split(':').map(Number);

      let start = new Date(2000, 0, 1, startH, startM);
      let end = new Date(2000, 0, 1, endH, endM);

      if (end <= start) {
        end = new Date(2000, 0, 2, endH, endM);
      }

      let minsD = 0, minsN = 0, minsDF = 0, minsNF = 0;
      let current = new Date(start);

      while (current < end) {
        const hour = current.getHours();
        const isSecondDay = current.getDate() > start.getDate();
        const isHolidayNow = isSecondDay ? shift.isHolidayEnd : shift.isHolidayStart;
        
        // Day: 6:00 AM to 7:00 PM (19:00)
        const isDaytime = hour >= 6 && hour < 19;

        if (isDaytime && !isHolidayNow) minsD++;
        else if (!isDaytime && !isHolidayNow) minsN++;
        else if (isDaytime && isHolidayNow) minsDF++;
        else if (!isDaytime && isHolidayNow) minsNF++;

        current.setMinutes(current.getMinutes() + 1);
      }

      setQuantities(prev => {
        const h = {
          day: Math.round((minsD / 60) * 100) / 100,
          night: Math.round((minsN / 60) * 100) / 100,
          holidayDay: Math.round((minsDF / 60) * 100) / 100,
          holidayNight: Math.round((minsNF / 60) * 100) / 100,
        };

        return {
          ...prev,
          hours: shift.isAVAShift ? { day: 0, night: 0, holidayDay: 0, holidayNight: 0 } : h,
          ava: shift.isAVAShift ? h : prev.ava,
          patients: prev.applyPatients ? h : prev.patients
        };
      });
    };

    calculateDistribution();
  }, [shift.startTime, shift.endTime, shift.isHolidayStart, shift.isHolidayEnd, shift.isAVAShift]);

  // --- Actions ---
  const addRecord = async () => {
    if (!user) return;
    const recordId = crypto.randomUUID();
    const newRecord: ShiftRecord = {
      id: recordId,
      userId: user.uid,
      date: shift.date,
      startTime: shift.startTime,
      endTime: shift.endTime,
      hours: { ...quantities.hours },
      ava: { ...quantities.ava },
      patients: { ...quantities.patients },
      applyPatients: quantities.applyPatients,
      isDefinitive: false, // Default to projection
    };
    
    const path = `users/${user.uid}/records/${recordId}`;
    try {
      await setDoc(doc(db, path), newRecord);
      // Reset patient and AVA counts for next entry
      setQuantities(prev => ({
        ...prev,
        ava: { day: 0, night: 0, holidayDay: 0, holidayNight: 0 },
        patients: prev.applyPatients ? (shift.isAVAShift ? { ...prev.ava } : { ...prev.hours }) : { day: 0, night: 0, holidayDay: 0, holidayNight: 0 }
      }));
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  };

  const removeRecord = async (id: string) => {
    if (!user) return;
    const path = `users/${user.uid}/records/${id}`;
    try {
      await deleteDoc(doc(db, path));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  };

  const toggleRecordStatus = async (id: string) => {
    if (!user) return;
    const record = records.find(r => r.id === id);
    if (!record) return;
    const path = `users/${user.uid}/records/${id}`;
    try {
      await updateDoc(doc(db, path), { isDefinitive: !record.isDefinitive });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  };

  const editRecord = (record: ShiftRecord) => {
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
    removeRecord(record.id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const exportToCSV = () => {
    if (records.length === 0) {
      alert('No hay registros para exportar.');
      return;
    }

    const headers = [
      'Fecha', 'Inicio', 'Fin', 'Estado',
      'Horas Diu', 'Horas Noc', 'Horas F-Diu', 'Horas F-Noc',
      'AVA Diu', 'AVA Noc', 'AVA F-Diu', 'AVA F-Noc',
      'Pac Diu', 'Pac Noc', 'Pac F-Diu', 'Pac F-Noc'
    ];

    const rows = records.map(r => [
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
    rows.push(['Total Bruto', results.gross]);
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
    link.setAttribute('download', `liquidacion_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // --- Persistence Actions ---
  const saveCurrentCalculation = () => {
    if (!calcName.trim()) {
      alert('Por favor, ingresa un nombre para guardar la liquidación.');
      return;
    }
    if (records.length === 0) {
      alert('No hay turnos para guardar.');
      return;
    }

    const newSaved: SavedCalculation = {
      id: crypto.randomUUID(),
      name: calcName.trim(),
      timestamp: new Date().toLocaleString(),
      records: [...records],
      rates: { ...rates },
      additionalDeductions: additionalDeductions
    };

    setSavedCalculations([newSaved, ...savedCalculations]);
    setCalcName('');
    alert('Liquidación guardada con éxito.');
  };

  const loadCalculation = (saved: SavedCalculation) => {
    if (records.length > 0 && !confirm('¿Estás seguro? Se perderán los datos actuales no guardados.')) {
      return;
    }
    setRecords(saved.records);
    setRates(saved.rates);
    setAdditionalDeductions(Array.isArray(saved.additionalDeductions) ? saved.additionalDeductions : []);
    alert(`Liquidación "${saved.name}" cargada.`);
  };

  const deleteSavedCalculation = (id: string) => {
    if (confirm('¿Eliminar esta liquidación guardada?')) {
      setSavedCalculations(savedCalculations.filter(s => s.id !== id));
    }
  };

  const addDeduction = async () => {
    if (!user) return;
    const deductionId = crypto.randomUUID();
    const deduction: Deduction = {
      id: deductionId,
      concept: '',
      amount: 0
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
    const patientsBreakdown = { day: 0, night: 0, holidayDay: 0, holidayNight: 0 };

    records.forEach(record => {
      // Hours
      hoursBreakdown.day += record.hours.day;
      hoursBreakdown.night += record.hours.night;
      hoursBreakdown.holidayDay += record.hours.holidayDay;
      hoursBreakdown.holidayNight += record.hours.holidayNight;

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

      if (record.applyPatients) {
        patientsBreakdown.day += record.patients.day;
        patientsBreakdown.night += record.patients.night;
        patientsBreakdown.holidayDay += record.patients.holidayDay;
        patientsBreakdown.holidayNight += record.patients.holidayNight;

        totalP += 
          (record.patients.day * rates.patient.day) +
          (record.patients.night * rates.patient.night) +
          (record.patients.holidayDay * rates.patient.holidayDay) +
          (record.patients.holidayNight * rates.patient.holidayNight);
      }
    });

    const totalMonthlyHours = hoursBreakdown.day + hoursBreakdown.night + hoursBreakdown.holidayDay + hoursBreakdown.holidayNight;
    const totalMonthlyPatients = patientsBreakdown.day + patientsBreakdown.night + patientsBreakdown.holidayDay + patientsBreakdown.holidayNight;

    const gross = totalH + totalP + totalAVA;
    const ibc = gross;

    const health = ibc * 0.04;
    const pension = ibc * 0.04;
    
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
    const legalDeductions = health + pension + fsp;

    // --- Prima No Constitutiva ---
    const primaNoConstitutiva = (rates.payroll.primaBaseAverage * rates.payroll.primaPercentage) / 100;

    // --- Retefuente Calculation (Procedimiento 1) ---
    const uvt = rates.payroll.uvtValue;
    // The tax base includes all income received this month
    const totalIncomeForTax = gross + primaNoConstitutiva;
    const baseGravable1 = totalIncomeForTax - legalDeductions;
    
    // Deductions allowed (capped)
    const dedDependents = Math.min(totalIncomeForTax * 0.1, 32 * uvt);
    const dedPrepagada = Math.min(rates.payroll.prepagada, 16 * uvt);
    const dedPensionVol = Math.min(rates.payroll.pensionVoluntaria, totalIncomeForTax * 0.3);
    
    const subtotal1 = baseGravable1 - dedDependents - dedPrepagada - dedPensionVol;
    
    // 25% Exempt Income (Capped at 790 UVT/year -> 65.8 UVT/month)
    const exempt25 = Math.min(subtotal1 * 0.25, 65.8 * uvt);
    
    const baseGravableFinal = subtotal1 - exempt25;
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

    // --- Vacation Provision (Informative) ---
    const vacationProvision = (gross * rates.payroll.vacationProvisionRate) / 100;

    const totalDeductions = legalDeductions + sumAdditionalDeductions + retefuente;
    const net = gross + primaNoConstitutiva - totalDeductions;

    return {
      totalH,
      totalP,
      totalAVA,
      gross,
      health,
      pension,
      fsp,
      retefuente,
      primaNoConstitutiva,
      vacationProvision,
      legalDeductions,
      additionalDeductions: sumAdditionalDeductions,
      totalDeductions,
      net,
      hoursBreakdown,
      patientsBreakdown,
      totalMonthlyHours,
      totalMonthlyPatients
    };
  }, [records, rates, additionalDeductions]);

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
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">Calculadora Médica</h1>
            <p className="text-slate-500 text-sm">Gestiona tus turnos y liquidaciones de forma segura en la nube.</p>
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
            <h1 className="text-xl font-bold tracking-tight text-slate-800">Bitácora y Liquidador Médico</h1>
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

      <div className="flex flex-col lg:flex-row">
        {/* Sidebar: Configuration */}
        <aside className={`
          ${isSidebarOpen ? 'w-full lg:w-80' : 'w-0 overflow-hidden'} 
          bg-white border-r border-slate-200 transition-all duration-300 ease-in-out
          lg:sticky lg:top-[73px] lg:h-[calc(100vh-73px)] overflow-y-auto
        `}>
          <div className="p-6 space-y-8">
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
                      { label: 'Diurna Ordinaria', key: 'day' },
                      { label: 'Nocturna Ordinaria', key: 'night' },
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
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Parámetros de Nómina (Indefinido)</h3>
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
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1 flex items-center gap-1">
                        Deducción por Dependientes ($)
                        <span title="Deducción mensual por personas a cargo (máx 10% ingreso o 32 UVT)"><Info className="w-3 h-3 text-slate-400" /></span>
                      </label>
                      <input 
                        type="number"
                        value={rates.payroll.dependents}
                        onChange={(e) => setRates({
                          ...rates,
                          payroll: { ...rates.payroll, dependents: Number(e.target.value) }
                        })}
                        className="w-full bg-white border border-slate-200 rounded-xl py-2 px-3 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-mono"
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
                        Base Promedio Prima ($)
                        <span title="Promedio de ingresos de los últimos meses para el cálculo de la prima"><Info className="w-3 h-3 text-indigo-400" /></span>
                      </label>
                      <input 
                        type="number"
                        value={rates.payroll.primaBaseAverage}
                        onChange={(e) => setRates({
                          ...rates,
                          payroll: { ...rates.payroll, primaBaseAverage: Number(e.target.value) }
                        })}
                        className="w-full bg-white border border-indigo-100 rounded-xl py-2 px-3 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-indigo-500 uppercase mb-1 flex items-center gap-1">
                        % Prima No Constitutiva
                        <span title="Porcentaje de la prima que no constituye salario"><Info className="w-3 h-3 text-indigo-400" /></span>
                      </label>
                      <input 
                        type="number"
                        value={rates.payroll.primaPercentage}
                        onChange={(e) => setRates({
                          ...rates,
                          payroll: { ...rates.payroll, primaPercentage: Number(e.target.value) }
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
                <h2 className="text-sm font-bold uppercase tracking-widest">Liquidaciones Guardadas</h2>
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
          {/* Step 2: Register Shift */}
          <section className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-slate-800 text-white flex items-center justify-center font-bold text-sm">2</div>
              <h2 className="text-xl font-bold text-slate-800">Registrar un Nuevo Turno</h2>
            </div>
            
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-6">
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
                        onChange={(e) => setShift({ ...shift, isAVAShift: e.target.checked })}
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
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-indigo-600">
                      <Users className="w-4 h-4" />
                      <h3 className="text-sm font-bold">Pacientes Atendidos</h3>
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input 
                        type="checkbox" 
                        checked={quantities.applyPatients}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setQuantities(prev => ({ 
                            ...prev, 
                            applyPatients: checked,
                            patients: checked ? (shift.isAVAShift ? { ...prev.ava } : { ...prev.hours }) : prev.patients
                          }));
                        }}
                        className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className="text-xs text-slate-600">Aplica cobro</span>
                    </label>
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
                          onChange={(e) => setQuantities({
                            ...quantities,
                            patients: { ...quantities.patients, [item.key]: Number(e.target.value) }
                          })}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-mono disabled:opacity-50"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <button 
                onClick={addRecord}
                className="w-full bg-indigo-600 text-white font-bold py-4 rounded-2xl shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all flex items-center justify-center gap-2"
              >
                <Calculator className="w-5 h-5" />
                Agregar a la Bitácora
              </button>
            </div>
          </section>

          {/* Step 3: Log (Bitácora) */}
          <section className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-slate-800 text-white flex items-center justify-center font-bold text-sm">3</div>
              <h2 className="text-xl font-bold text-slate-800">Bitácora de Turnos (Acumulado)</h2>
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
                      <th className="p-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Horas Ord/Fest</th>
                      <th className="p-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Horas AVA</th>
                      <th className="p-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Pacientes</th>
                      <th className="p-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">Estado</th>
                      <th className="p-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    <AnimatePresence initial={false}>
                      {records.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="p-10 text-center text-slate-400 italic">No hay turnos registrados aún. Agrega tu primer turno arriba.</td>
                        </tr>
                      ) : (
                        records.map((record) => (
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
                </table>
              </div>
            </div>
          </section>

          {/* Save Calculation */}
          {records.length > 0 && (
            <section className="bg-indigo-50 p-6 rounded-3xl border border-indigo-100 flex flex-col md:flex-row items-center gap-4">
              <div className="flex items-center gap-3 shrink-0">
                <div className="bg-white p-2 rounded-xl shadow-sm">
                  <Save className="text-indigo-600 w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-800">Guardar Liquidación</h3>
                  <p className="text-[10px] text-slate-500 uppercase font-bold">Persiste tus datos localmente</p>
                </div>
              </div>
              <div className="flex-1 w-full flex gap-2">
                <input 
                  type="text" 
                  placeholder="Nombre de la liquidación (ej: Marzo 2026)"
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

          {/* Step 4: Results */}
          <section className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-slate-800 text-white flex items-center justify-center font-bold text-sm">4</div>
              <h2 className="text-xl font-bold text-slate-800">Liquidación Final</h2>
            </div>

            {records.length > 0 ? (
              <>
                {/* Reporte de Cantidades */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm"
                  >
                    <div className="flex items-center gap-2 text-indigo-600 mb-4">
                      <Clock className="w-4 h-4" />
                      <h3 className="text-xs font-bold uppercase tracking-widest">Reporte de Horas Mensuales</h3>
                    </div>
                    <div className="space-y-3">
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-slate-500">Horas Diurnas</span>
                        <span className="font-bold text-slate-700">{results.hoursBreakdown.day}h</span>
                      </div>
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-slate-500">Horas Nocturnas</span>
                        <span className="font-bold text-slate-700">{results.hoursBreakdown.night}h</span>
                      </div>
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-slate-500">Horas Festivas Diurnas</span>
                        <span className="font-bold text-slate-700">{results.hoursBreakdown.holidayDay}h</span>
                      </div>
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-slate-500">Horas Festivas Nocturnas</span>
                        <span className="font-bold text-slate-700">{results.hoursBreakdown.holidayNight}h</span>
                      </div>
                      <div className="pt-3 border-t border-slate-100 flex justify-between items-center">
                        <span className="text-xs font-bold text-slate-400 uppercase">Total Horas</span>
                        <span className="text-lg font-black text-indigo-600 font-mono">{results.totalMonthlyHours}h</span>
                      </div>
                    </div>
                  </motion.div>

                  <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm"
                  >
                    <div className="flex items-center gap-2 text-emerald-600 mb-4">
                      <Users className="w-4 h-4" />
                      <h3 className="text-xs font-bold uppercase tracking-widest">Reporte de Pacientes</h3>
                    </div>
                    <div className="space-y-3">
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-slate-500">Pacientes Diurnos</span>
                        <span className="font-bold text-slate-700">{results.patientsBreakdown.day}</span>
                      </div>
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-slate-500">Pacientes Nocturnos</span>
                        <span className="font-bold text-slate-700">{results.patientsBreakdown.night}</span>
                      </div>
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-slate-500">Pacientes Festivos Diurnos</span>
                        <span className="font-bold text-slate-700">{results.patientsBreakdown.holidayDay}</span>
                      </div>
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-slate-500">Pacientes Festivos Nocturnos</span>
                        <span className="font-bold text-slate-700">{results.patientsBreakdown.holidayNight}</span>
                      </div>
                      <div className="pt-3 border-t border-slate-100 flex justify-between items-center">
                        <span className="text-xs font-bold text-slate-400 uppercase">Total Pacientes</span>
                        <span className="text-lg font-black text-emerald-600 font-mono">{results.totalMonthlyPatients}</span>
                      </div>
                    </div>
                  </motion.div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <motion.div 
                    whileHover={{ y: -4 }}
                    className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm"
                  >
                    <div className="flex items-center gap-2 text-slate-400 mb-2">
                      <TrendingUp className="w-4 h-4" />
                      <span className="text-[10px] font-bold uppercase tracking-widest">Total Devengado</span>
                    </div>
                    <div className="text-2xl font-black text-slate-800 font-mono">{formatCurrency(results.gross)}</div>
                    <div className="mt-2 text-[10px] text-slate-400 font-medium">Ingreso Bruto acumulado</div>
                  </motion.div>

                  <motion.div 
                    whileHover={{ y: -4 }}
                    className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm"
                  >
                    <div className="flex items-center gap-2 text-rose-400 mb-2">
                      <TrendingDown className="w-4 h-4" />
                      <span className="text-[10px] font-bold uppercase tracking-widest">Total Deducido</span>
                    </div>
                    <div className="text-2xl font-black text-rose-600 font-mono">-{formatCurrency(results.totalDeductions)}</div>
                    <div className="mt-2 text-[10px] text-slate-400 font-medium">Legales + Adicionales</div>
                  </motion.div>

                  <motion.div 
                    whileHover={{ y: -4 }}
                    className="bg-indigo-600 p-6 rounded-3xl shadow-xl shadow-indigo-200 text-white"
                  >
                    <div className="flex items-center gap-2 text-indigo-200 mb-2">
                      <Wallet className="w-4 h-4" />
                      <span className="text-[10px] font-bold uppercase tracking-widest">Neto a Pagar</span>
                    </div>
                    <div className="text-2xl font-black font-mono">{formatCurrency(results.net)}</div>
                    <div className="mt-2 text-[10px] text-indigo-200 font-medium">Valor real a recibir</div>
                  </motion.div>
                </div>

                {/* Detailed Breakdown */}
                <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden">
                  <button 
                    onClick={() => setShowDetails(!showDetails)}
                    className="w-full p-6 flex items-center justify-between hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <Calculator className="w-5 h-5 text-indigo-600" />
                      <span className="font-bold text-slate-800">Ver desglose financiero detallado</span>
                    </div>
                    {showDetails ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                  </button>

                  <AnimatePresence>
                    {showDetails && (
                      <motion.div 
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="border-t border-slate-100"
                      >
                        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-8">
                          <div className="space-y-4">
                            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest">💰 Origen de los Ingresos</h4>
                            <div className="space-y-3">
                              <div className="flex justify-between items-center p-3 bg-slate-50 rounded-xl">
                                <span className="text-sm text-slate-600">Total por Horas</span>
                                <span className="font-bold font-mono">{formatCurrency(results.totalH)}</span>
                              </div>
                              <div className="flex justify-between items-center p-3 bg-slate-50 rounded-xl">
                                <span className="text-sm text-slate-600">Total por AVA</span>
                                <span className="font-bold font-mono">{formatCurrency(results.totalAVA)}</span>
                              </div>
                              <div className="flex justify-between items-center p-3 bg-slate-50 rounded-xl">
                                <span className="text-sm text-slate-600">Total por Pacientes</span>
                                <span className="font-bold font-mono">{formatCurrency(results.totalP)}</span>
                              </div>
                            </div>
                          </div>

                          <div className="space-y-4">
                            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest">📉 Detalle de Descuentos (Empleado)</h4>
                            <div className="space-y-2">
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="text-left text-[10px] text-slate-400 uppercase tracking-wider">
                                    <th className="pb-2 font-bold">Concepto</th>
                                    <th className="pb-2 font-bold text-right">Valor</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                  <tr>
                                    <td className="py-2 text-slate-600">Salud (4%)</td>
                                    <td className="py-2 text-right font-mono font-medium">{formatCurrency(results.health)}</td>
                                  </tr>
                                  <tr>
                                    <td className="py-2 text-slate-600">Pensión (4%)</td>
                                    <td className="py-2 text-right font-mono font-medium">{formatCurrency(results.pension)}</td>
                                  </tr>
                                  <tr>
                                    <td className="py-2 text-slate-600">FSP (Solidaridad)</td>
                                    <td className="py-2 text-right font-mono font-medium">{formatCurrency(results.fsp)}</td>
                                  </tr>
                                  <tr>
                                    <td className="py-2 text-indigo-600 font-bold">Retención en la Fuente</td>
                                    <td className="py-2 text-right font-mono font-bold text-indigo-600">{formatCurrency(results.retefuente)}</td>
                                  </tr>
                                  <tr className="border-t border-slate-100">
                                    <td className="py-2 text-slate-500 italic">Total Deducciones Legales</td>
                                    <td className="py-2 text-right font-mono text-slate-500">{formatCurrency(results.legalDeductions + results.retefuente)}</td>
                                  </tr>
                                  {additionalDeductions.map((d) => (
                                    <tr key={d.id}>
                                      <td className="py-2 text-indigo-600 font-medium">{d.concept || 'Sin concepto'}</td>
                                      <td className="py-2 text-right font-mono font-bold text-indigo-600">{formatCurrency(d.amount)}</td>
                                    </tr>
                                  ))}
                                  <tr className="font-bold text-rose-600 border-t-2 border-slate-100">
                                    <td className="py-3">Total Deducciones</td>
                                    <td className="py-3 text-right font-mono">{formatCurrency(results.totalDeductions)}</td>
                                  </tr>
                                </tbody>
                              </table>
                              
                              <div className="space-y-4 mt-6 pt-6 border-t border-slate-100">
                                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest">✨ Beneficios y Provisiones</h4>
                                <div className="space-y-3">
                                  <div className="flex justify-between items-center p-3 bg-indigo-50 rounded-xl border border-indigo-100">
                                    <div className="flex items-center gap-2">
                                      <div>
                                        <span className="text-sm text-indigo-700 font-bold">Prima No Constitutiva</span>
                                        <p className="text-[10px] text-indigo-500">Calculada sobre acumulado promedio</p>
                                      </div>
                                      <span title="Pago extra que no constituye salario para aportes pero sí para Retefuente."><Info className="w-3.5 h-3.5 text-indigo-400" /></span>
                                    </div>
                                    <span className="font-bold font-mono text-indigo-700">+{formatCurrency(results.primaNoConstitutiva)}</span>
                                  </div>
                                  <div className="flex justify-between items-center p-3 bg-emerald-50 rounded-xl border border-emerald-100">
                                    <div className="flex items-center gap-2">
                                      <div>
                                        <span className="text-sm text-emerald-700 font-bold">Provisión Vacaciones</span>
                                        <p className="text-[10px] text-emerald-500">Informativo (4.17%)</p>
                                      </div>
                                      <span title="Monto que el empleador reserva mensualmente para tus vacaciones (15 días por año)."><Info className="w-3.5 h-3.5 text-emerald-400" /></span>
                                    </div>
                                    <span className="font-bold font-mono text-emerald-700">{formatCurrency(results.vacationProvision)}</span>
                                  </div>
                                </div>
                              </div>
                            </div>
                              <p className="text-[10px] text-slate-400 italic mt-4">* ARL: Asumida por el empleador. El FSP aplica si el total mensual supera 4 salarios mínimos.</p>
                            </div>
                          </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </>
            ) : (
              <div className="bg-white p-10 rounded-3xl border border-slate-200 text-center text-slate-400">
                <Info className="w-8 h-8 mx-auto mb-4 opacity-20" />
                <p>Ingresa al menos un turno para calcular la liquidación financiera.</p>
              </div>
            )}
          </section>
        </main>
      </div>

      {/* Footer Info */}
      <footer className="bg-slate-900 text-slate-400 p-10 text-center space-y-4">
        <div className="flex items-center justify-center gap-2 text-white">
          <Stethoscope className="w-5 h-5" />
          <span className="font-bold tracking-tight">Liquidador Médico Laboral</span>
        </div>
        <p className="text-xs max-w-md mx-auto leading-relaxed">
          Herramienta diseñada para profesionales de la salud en Colombia. 
          Cálculos basados en la normativa laboral vigente para 2026.
        </p>
        <div className="pt-4 border-t border-slate-800 text-[10px] uppercase tracking-widest">
          © 2026 • Desarrollado para el Gremio Médico
        </div>
      </footer>
    </div>
  );
}
