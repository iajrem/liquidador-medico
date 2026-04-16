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
  Upload,
  RotateCcw,
  FileDown,
  AlertTriangle,
  Monitor
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
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
  getDoc,
  getDocs,
  query,
  where,
  onSnapshot, 
  deleteDoc, 
  updateDoc, 
  writeBatch,
  handleFirestoreError, 
  OperationType,
  User
} from './firebase';
import { Component, ErrorInfo, ReactNode } from 'react';

import { HELP_CONTENT } from './constants/helpContent';
import { useAuth } from './hooks/useAuth';

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
  userId: string;
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
  extraThreshold?: number;         // Límite de horas para activar extras
  totalGross?: number;             // gross (solo turnos)
  totalGrossWithBenefits?: number; // totalGross del useMemo (con prima, vacaciones)
  totalDeductions?: number;
  net?: number;
  primaProporcional?: number;
  vacacionesProporcional?: number;
  cesantiasProporcional?: number;
  interesesCesantias?: number;
  rates?: Rates;
}

interface Trisemana {
  id: string;
  userId: string;
  name: string;
  startDate: string;
  endDate: string;
  maxHours: number;
  status: 'active' | 'archived';
  createdAt: string;
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
  base: {
    consultation: number; // 23338
    service: number;      // 10825
    ava: number;          // 37709
    virtual: number;      // 37709
  };
  surcharges: {
    night: number;        // 0.35
    holidayDay: number;   // 0.80
    holidayNight: number; // 1.15
    extraDay: number;     // 0.25
    extraNight: number;   // 0.75
    extraHolidayDay: number;
    extraHolidayNight: number;
  };
  hourly: {
    day: number;
    night: number;
    holidayDay: number;
    holidayNight: number;
    extraDay: number;
    extraNight: number;
    extraHolidayDay: number;
    extraHolidayNight: number;
  };
  ava: {
    day: number;
    night: number;
    holidayDay: number;
    holidayNight: number;
    extraDay: number;
    extraNight: number;
    extraHolidayDay: number;
    extraHolidayNight: number;
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
    vacationLastResetDate: string | null; // ISO date of last vacation reset
    ibcMinimo: boolean;         // If true, IBC is capped at SMMLV if gross > SMMLV
    jobTitle: string;
  };
}

interface ShiftInput {
  date: string;
  startTime: string;
  endTime: string;
  isHolidayStart: boolean;
  isHolidayEnd: boolean;
  isAVAShift: boolean;
  isVirtualShift: boolean;
  isExtraShift: boolean;
  extraHoursType: 'consultation' | 'avaVirtual';
}

interface Quantities {
  hours: {
    day: number;
    night: number;
    holidayDay: number;
    holidayNight: number;
    extraDay: number;
    extraNight: number;
    extraHolidayDay: number;
    extraHolidayNight: number;
  };
  ava: {
    day: number;
    night: number;
    holidayDay: number;
    holidayNight: number;
    extraDay: number;
    extraNight: number;
    extraHolidayDay: number;
    extraHolidayNight: number;
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
  isExtraShift: boolean;
  isHolidayStart: boolean;
  isHolidayEnd: boolean;
  isAVAShift: boolean;
  isVirtualShift: boolean;
  extraHoursType?: 'consultation' | 'avaVirtual';
  trisemanaId?: string | null;
}

// --- Constants ---

const SMMLV_2026 = 1750905;

const DEFAULT_RATES: Rates = {
  base: {
    consultation: 23338,
    service: 10825,
    ava: 37709,
    virtual: 37709,
  },
  surcharges: {
    night: 0.35,
    holidayDay: 0.80,
    holidayNight: 1.15,
    extraDay: 0.25,
    extraNight: 0.75,
    extraHolidayDay: 0.25,
    extraHolidayNight: 0.75
  },
  hourly: {
    day: 23338,
    night: 31506,
    holidayDay: 42008,
    holidayNight: 50177,
    extraDay: 29173,
    extraNight: 40842,
    extraHolidayDay: 46676,
    extraHolidayNight: 58345,
  },
  ava: {
    day: 37708,
    night: 50906,
    holidayDay: 67874,
    holidayNight: 81072,
    extraDay: 47135,
    extraNight: 65989,
    extraHolidayDay: 75416,
    extraHolidayNight: 94271,
  },
  patient: {
    day: 10825,
    night: 14613,
    holidayDay: 19485,
    holidayNight: 23273,
  },
  payroll: {
    uvtValue: 49794,
    dependents: false,
    prepagada: 0,
    pensionVoluntaria: 0,
    interesesVivienda: 0,
    avgBilling12Months: 0,
    avgBilling6Months: 0,
    billingCutoffDay: 25,
    nightShiftStart: 19,
    vacationLastResetDate: null,
    ibcMinimo: false,
    jobTitle: 'MEDICO CONSULTA 2 MED',
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

// --- Helper Functions ---
interface ShiftDistribution {
  ord: { day: number; night: number; holidayDay: number; holidayNight: number };
  extra: { day: number; night: number; holidayDay: number; holidayNight: number };
}

const calculateShiftValue = (record: ShiftRecord, rates: Rates, dist: ShiftDistribution) => {
  if (!dist) return { base: 0, service: 0, extraSurcharge: 0, avaVirtual: 0 };

  const h = rates.hourly;
  const a = rates.ava;
  const p = rates.patient;

  // 1. Calculate Ordinary Part
  let ordBasePart = 0;
  let ordServicePart = 0;
  let ordAVAPart = 0;

  if (record.isAVAShift || record.isVirtualShift) {
    ordAVAPart = (dist.ord.day * a.day) + 
                 (dist.ord.night * a.night) + 
                 (dist.ord.holidayDay * a.holidayDay) + 
                 (dist.ord.holidayNight * a.holidayNight);
  } else {
    ordBasePart = (dist.ord.day * h.day) + 
                  (dist.ord.night * h.night) + 
                  (dist.ord.holidayDay * h.holidayDay) + 
                  (dist.ord.holidayNight * h.holidayNight);
    
    ordServicePart = (dist.ord.day * p.day) + 
                     (dist.ord.night * p.night) + 
                     (dist.ord.holidayDay * p.holidayDay) + 
                     (dist.ord.holidayNight * p.holidayNight);
  }

  // 2. Calculate Extra Part
  let extraBasePart = 0;
  let extraSurchargePart = 0;
  let extraAVAPart = 0;

  const extraType = record.extraHoursType || (record.isAVAShift ? 'avaVirtual' : 'consultation');

  if (extraType === 'avaVirtual') {
    extraAVAPart = (dist.extra.day * a.extraDay) + 
                   (dist.extra.night * a.extraNight) + 
                   (dist.extra.holidayDay * a.extraHolidayDay) + 
                   (dist.extra.holidayNight * a.extraHolidayNight);
  } else {
    extraBasePart = (dist.extra.day * h.extraDay) + 
                    (dist.extra.night * h.extraNight) + 
                    (dist.extra.holidayDay * h.extraHolidayDay) + 
                    (dist.extra.holidayNight * h.extraHolidayNight);
  }

  return { 
    base: ordBasePart + extraBasePart, 
    service: ordServicePart, 
    extraSurcharge: extraSurchargePart, // This is now included in the extra rates
    avaVirtual: ordAVAPart + extraAVAPart 
  };
};

// --- Pure Calculation Logic (Correction 2 & 4) ---
const calculateShiftDistribution = (s: { startTime: string, endTime: string, isHolidayStart: boolean, isHolidayEnd: boolean, isExtraShift?: boolean }, r: Rates, threshold: number = 0) => {
  const [startH, startM] = s.startTime.split(':').map(Number);
  const [endH, endM] = s.endTime.split(':').map(Number);

  const startTotal = startH * 60 + startM;
  let endTotal = endH * 60 + endM;
  if (endTotal <= startTotal) endTotal += 24 * 60; // turno cruza medianoche

  const nightStart = r.payroll.nightShiftStart * 60; // en minutos
  const dayStart = 6 * 60;

  const calculateForRange = (rangeStart: number, rangeEnd: number) => {
    let mD = 0, mN = 0, mDF = 0, mNF = 0;
    const addBlockRange = (from: number, to: number, isHoliday: boolean, isDay: boolean) => {
      const overlap = Math.max(0, Math.min(to, rangeEnd) - Math.max(from, rangeStart));
      if (overlap <= 0) return;
      if (isDay && !isHoliday) mD += overlap;
      else if (!isDay && !isHoliday) mN += overlap;
      else if (isDay && isHoliday) mDF += overlap;
      else mNF += overlap;
    };

    // Primer día (minutos 0..1440)
    const h = s.isHolidayStart;
    addBlockRange(0,        dayStart,   h, false); // 00:00-06:00 nocturno
    addBlockRange(dayStart, nightStart, h, true);  // 06:00-nightStart diurno
    addBlockRange(nightStart, 1440,     h, false); // nightStart-24:00 nocturno

    // Segundo día, si el turno cruza medianoche (minutos 1440..2880)
    if (rangeEnd > 1440) {
      const h2 = s.isHolidayEnd;
      addBlockRange(1440,        1440 + dayStart,   h2, false);
      addBlockRange(1440 + dayStart, 1440 + nightStart, h2, true);
      addBlockRange(1440 + nightStart, 2880,          h2, false);
    }
    return { mD, mN, mDF, mNF };
  };

  const ordEnd = s.isExtraShift ? startTotal : (threshold > 0 ? Math.min(endTotal, startTotal + threshold * 60) : startTotal);
  const ord = calculateForRange(startTotal, ordEnd);
  const extra = (s.isExtraShift || (threshold >= 0 && endTotal > ordEnd)) ? calculateForRange(ordEnd, endTotal) : { mD: 0, mN: 0, mDF: 0, mNF: 0 };

  const round2 = (n: number) => Math.round(n * 100) / 100;
  return {
    ord: {
      day:         round2(ord.mD / 60),
      night:       round2(ord.mN / 60),
      holidayDay:  round2(ord.mDF / 60),
      holidayNight: round2(ord.mNF / 60),
    },
    extra: {
      day:         round2(extra.mD / 60),
      night:       round2(extra.mN / 60),
      holidayDay:  round2(extra.mDF / 60),
      holidayNight: round2(extra.mNF / 60),
    }
  };
};

const calculatePeriodTotals = (
  records: ShiftRecord[],
  rates: Rates,
  additionalDeductions: Deduction[],
  periods: BillingPeriod[],
  selectedPeriodId: string | null,
  allRecords: ShiftRecord[] = [],
  trisemanas: Trisemana[] = []
) => {
  let totalH = 0;
  let totalP = 0;
  let totalAVA = 0;

  const hoursBreakdown = { 
    day: 0, night: 0, holidayDay: 0, holidayNight: 0,
    extraDay: 0, extraNight: 0, extraHolidayDay: 0, extraHolidayNight: 0
  };
  const avaVirtualBreakdown = { 
    day: 0, night: 0, holidayDay: 0, holidayNight: 0,
    extraDay: 0, extraNight: 0, extraHolidayDay: 0, extraHolidayNight: 0
  };
  const patientsBreakdown = { day: 0, night: 0, holidayDay: 0, holidayNight: 0 };
  const monthlyHours: { [key: string]: number } = {};
  const trisemanaBreakdown: { [trisemanaId: string]: { name: string, ord: number, extra: number } } = {};

  // Components for the new additive logic
  const components = {
    base: 0,
    service: 0,
    extraSurcharge: 0,
    avaVirtual: 0
  };

  // 1. Pre-calculate distributions for all records in relevant Trisemanas
  // This ensures cumulative hours track correctly across billing periods
  const recordDistributions: { [recordId: string]: any } = {};
  
  // Find all trisemanas that could affect the current records
  const relevantTrisemanas = trisemanas
    .filter(t => records.some(r => r.trisemanaId === t.id || (!r.trisemanaId && r.date >= t.startDate && r.date <= t.endDate)))
    .sort((a, b) => a.startDate.localeCompare(b.startDate));

  relevantTrisemanas.forEach(trisemana => {
    // Get ALL records in this trisemana across all time/periods
    const trisemanaRecords = allRecords
      .filter(r => r.trisemanaId === trisemana.id || (!r.trisemanaId && r.date >= trisemana.startDate && r.date <= trisemana.endDate))
      .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
    
    let cumulative = 0;
    trisemanaRecords.forEach(r => {
      const remaining = Math.max(0, trisemana.maxHours - cumulative);
      const dist = calculateShiftDistribution({
        startTime: r.startTime,
        endTime: r.endTime,
        isHolidayStart: r.isHolidayStart || false,
        isHolidayEnd: r.isHolidayEnd || false,
        isExtraShift: r.isExtraShift || false
      }, rates, remaining);
      
      // Mark if this shift crossed the threshold
      const shiftHours = (dist.ord.day + dist.ord.night + dist.ord.holidayDay + dist.ord.holidayNight) +
                         (dist.extra.day + dist.extra.night + dist.extra.holidayDay + dist.extra.holidayNight);
      
      const crossedThreshold = cumulative < trisemana.maxHours && (cumulative + shiftHours) > trisemana.maxHours;
      const alreadyOver = cumulative >= trisemana.maxHours;

      recordDistributions[r.id] = { 
        ...dist, 
        crossedThreshold, 
        alreadyOver,
        cumulativeBefore: cumulative,
        cumulativeAfter: cumulative + (dist.ord.day + dist.ord.night + dist.ord.holidayDay + dist.ord.holidayNight)
      };
      
      // Only add to breakdown if the record is in the current period being calculated
      if (records.some(currR => currR.id === r.id)) {
        if (!trisemanaBreakdown[trisemana.id]) {
          trisemanaBreakdown[trisemana.id] = { name: trisemana.name, ord: 0, extra: 0 };
        }
        trisemanaBreakdown[trisemana.id].ord += (dist.ord.day + dist.ord.night + dist.ord.holidayDay + dist.ord.holidayNight);
        trisemanaBreakdown[trisemana.id].extra += (dist.extra.day + dist.extra.night + dist.extra.holidayDay + dist.extra.holidayNight);
      }

      // Only regular hours count towards the trisemana threshold
      cumulative += (dist.ord.day + dist.ord.night + dist.ord.holidayDay + dist.ord.holidayNight);
    });
  });

  // 2. Standard period threshold logic (fallback for records without Trisemana)
  const activePeriod = periods.find(p => p.id === selectedPeriodId);
  const periodThreshold = activePeriod?.extraThreshold || 0;
  let periodCumulativeHours = 0;

  // Sort records chronologically to apply threshold correctly
  const sortedRecords = [...records].sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));

  sortedRecords.forEach(record => {
    // Use pre-calculated trisemana distribution if available
    let dist = recordDistributions[record.id];
    
    if (!dist) {
      // Fallback: Standard period threshold logic
      const remainingToThreshold = periodThreshold > 0 ? Math.max(0, periodThreshold - periodCumulativeHours) : 999999;
      dist = calculateShiftDistribution({
        startTime: record.startTime,
        endTime: record.endTime,
        isHolidayStart: record.isHolidayStart || false,
        isHolidayEnd: record.isHolidayEnd || false,
        isExtraShift: record.isExtraShift || false
      }, rates, remainingToThreshold);
      periodCumulativeHours += (dist.ord.day + dist.ord.night + dist.ord.holidayDay + dist.ord.holidayNight);
      
      // Store it so it's available for the UI
      recordDistributions[record.id] = dist;
    }

    const isAVAMain = record.isAVAShift || record.isVirtualShift || (Object.values(record.ava || {}).some(v => v > 0) && Object.values(record.hours || {}).every(v => v === 0));

    // Regular Hours (Consulta)
    hoursBreakdown.day += dist.ord.day;
    hoursBreakdown.night += dist.ord.night;
    hoursBreakdown.holidayDay += dist.ord.holidayDay;
    hoursBreakdown.holidayNight += dist.ord.holidayNight;
    
    // Extra Hours (Consulta by default)
    hoursBreakdown.extraDay += dist.extra.day;
    hoursBreakdown.extraNight += dist.extra.night;
    hoursBreakdown.extraHolidayDay += dist.extra.holidayDay;
    hoursBreakdown.extraHolidayNight += dist.extra.holidayNight;

    // AVA or Virtual Hours (Ordinary)
    if (isAVAMain) {
      avaVirtualBreakdown.day += dist.ord.day;
      avaVirtualBreakdown.night += dist.ord.night;
      avaVirtualBreakdown.holidayDay += dist.ord.holidayDay;
      avaVirtualBreakdown.holidayNight += dist.ord.holidayNight;
      
      // Subtract from hoursBreakdown because it was added above
      hoursBreakdown.day -= dist.ord.day;
      hoursBreakdown.night -= dist.ord.night;
      hoursBreakdown.holidayDay -= dist.ord.holidayDay;
      hoursBreakdown.holidayNight -= dist.ord.holidayNight;
    }

    // Extra Hours Type override
    const extraType = record.extraHoursType || (isAVAMain ? 'avaVirtual' : 'consultation');
    if (extraType === 'avaVirtual') {
      avaVirtualBreakdown.extraDay += dist.extra.day;
      avaVirtualBreakdown.extraNight += dist.extra.night;
      avaVirtualBreakdown.extraHolidayDay += dist.extra.holidayDay;
      avaVirtualBreakdown.extraHolidayNight += dist.extra.holidayNight;

      // Subtract from hoursBreakdown
      hoursBreakdown.extraDay -= dist.extra.day;
      hoursBreakdown.extraNight -= dist.extra.night;
      hoursBreakdown.extraHolidayDay -= dist.extra.holidayDay;
      hoursBreakdown.extraHolidayNight -= dist.extra.holidayNight;
    }

    // --- Additive Calculation Logic ---
    const shiftValue = calculateShiftValue(record, rates, dist);
    components.base += shiftValue.base;
    components.service += shiftValue.service;
    components.extraSurcharge += shiftValue.extraSurcharge;
    components.avaVirtual += shiftValue.avaVirtual;

    const rDate = new Date(record.date + 'T00:00:00');
    const monthName = rDate.toLocaleString('es-ES', { month: 'long', year: 'numeric' });
    const recordTotalHours = (dist.ord.day + dist.ord.night + dist.ord.holidayDay + dist.ord.holidayNight) +
                             (dist.extra.day + dist.extra.night + dist.extra.holidayDay + dist.extra.holidayNight);
    
    monthlyHours[monthName] = (monthlyHours[monthName] || 0) + recordTotalHours;

    if (record.applyPatients) {
      patientsBreakdown.day += record.patients.day;
      patientsBreakdown.night += record.patients.night;
      patientsBreakdown.holidayDay += record.patients.holidayDay;
      patientsBreakdown.holidayNight += record.patients.holidayNight;
    }
  });

  const hoursValues = {
    day: hoursBreakdown.day * rates.base.consultation,
    night: hoursBreakdown.night * rates.base.consultation * (1 + rates.surcharges.night),
    holidayDay: hoursBreakdown.holidayDay * rates.base.consultation * (1 + rates.surcharges.holidayDay),
    holidayNight: hoursBreakdown.holidayNight * rates.base.consultation * (1 + rates.surcharges.holidayNight),
    extraDay: hoursBreakdown.extraDay * rates.base.consultation * rates.surcharges.extraDay,
    extraNight: hoursBreakdown.extraNight * rates.base.consultation * rates.surcharges.extraNight,
    extraHolidayDay: hoursBreakdown.extraHolidayDay * rates.base.consultation * rates.surcharges.extraDay,
    extraHolidayNight: hoursBreakdown.extraHolidayNight * rates.base.consultation * rates.surcharges.extraNight,
  };

  const avaVirtualValues = {
    day: avaVirtualBreakdown.day * rates.base.ava,
    night: avaVirtualBreakdown.night * rates.base.ava * (1 + rates.surcharges.night),
    holidayDay: avaVirtualBreakdown.holidayDay * rates.base.ava * (1 + rates.surcharges.holidayDay),
    holidayNight: avaVirtualBreakdown.holidayNight * rates.base.ava * (1 + rates.surcharges.holidayNight),
    extraDay: avaVirtualBreakdown.extraDay * rates.base.ava * rates.surcharges.extraDay,
    extraNight: avaVirtualBreakdown.extraNight * rates.base.ava * rates.surcharges.extraNight,
    extraHolidayDay: avaVirtualBreakdown.extraHolidayDay * rates.base.ava * rates.surcharges.extraDay,
    extraHolidayNight: avaVirtualBreakdown.extraHolidayNight * rates.base.ava * rates.surcharges.extraNight,
  };

  const patientsValues = {
    day: patientsBreakdown.day * rates.patient.day,
    night: patientsBreakdown.night * rates.patient.night,
    holidayDay: patientsBreakdown.holidayDay * rates.patient.holidayDay,
    holidayNight: patientsBreakdown.holidayNight * rates.patient.holidayNight,
  };

  totalH = components.base + components.extraSurcharge;
  totalAVA = components.avaVirtual;
  totalP = components.service + Object.values(patientsValues).reduce((a, b) => a + b, 0);

  const gross = totalH + totalP + totalAVA;
  const totalRegularHours = hoursBreakdown.day + hoursBreakdown.night + hoursBreakdown.holidayDay + hoursBreakdown.holidayNight +
                           avaVirtualBreakdown.day + avaVirtualBreakdown.night + avaVirtualBreakdown.holidayDay + avaVirtualBreakdown.holidayNight;
  const totalExtraHours = hoursBreakdown.extraDay + hoursBreakdown.extraNight + hoursBreakdown.extraHolidayDay + hoursBreakdown.extraHolidayNight +
                         avaVirtualBreakdown.extraDay + avaVirtualBreakdown.extraNight + avaVirtualBreakdown.extraHolidayDay + avaVirtualBreakdown.extraHolidayNight;
  const totalAllHours = totalRegularHours + totalExtraHours;

  let ibc = gross > 0 ? Math.max(Math.min(gross, SMMLV_2026 * 25), SMMLV_2026) : 0;
  
  if (rates.payroll.ibcMinimo && gross > SMMLV_2026) {
    ibc = SMMLV_2026;
  }

  const health = ibc * 0.04;
  const pension = ibc * 0.04;
  const arl = ibc * 0.00522;
  const caja = ibc * 0.04;
  
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
  const legalDeductions = health + pension + fsp; // ARL is paid by employer in Colombia for employees

  // --- Proportional Calculations based on Period History ---
  const currentEndDate = activePeriod ? new Date(activePeriod.endDate + 'T00:00:00') : new Date();
  const currentYear = currentEndDate.getFullYear();
  const currentMonth = currentEndDate.getMonth(); // 0-11
  const currentSemester = currentMonth < 6 ? 0 : 1; // 0: Jan-Jun, 1: Jul-Dec

  const otherPeriods = periods.filter(p => p.id !== selectedPeriodId && p.endDate < (activePeriod?.startDate || ''));
  const sortedOthers = [...otherPeriods].sort((a, b) => b.endDate.localeCompare(a.endDate));
  
  // Average 6 Months (Semester Reset for Primas)
  const semesterOthers = sortedOthers.filter(p => {
    const pDate = new Date(p.endDate + 'T00:00:00');
    const pSemester = pDate.getMonth() < 6 ? 0 : 1;
    return pDate.getFullYear() === currentYear && pSemester === currentSemester;
  });
  const last5Others = semesterOthers.slice(0, 5);
  const count6 = last5Others.length + (selectedPeriodId ? 1 : 0);
  const total6 = last5Others.reduce((sum, p) => sum + (p.totalGross || 0), 0) + (selectedPeriodId ? gross : 0);
  const avg6 = count6 > 0 ? total6 / count6 : 0;
  
  const primaProporcional = avg6 / 12;
  const cesantiasProporcional = avg6 / 12;
  const interesesCesantias = cesantiasProporcional * 0.12;

  // Average 12 Months (Manual Reset for Vacations)
  const vacationResetDate = rates.payroll.vacationLastResetDate;
  const vacationOthers = sortedOthers.filter(p => {
    if (!vacationResetDate) return true;
    return p.startDate >= vacationResetDate;
  });
  const last11Others = vacationOthers.slice(0, 11);
  const count12 = last11Others.length + (selectedPeriodId ? 1 : 0);
  const total12 = last11Others.reduce((sum, p) => sum + (p.totalGross || 0), 0) + (selectedPeriodId ? gross : 0);
  const avg12 = count12 > 0 ? total12 / count12 : 0;
  const vacacionesProporcional = avg12 / 24;

  // --- Retefuente ---
  const uvt = rates.payroll.uvtValue;
  const totalIncomeForTax = gross; 
  const netIncome = totalIncomeForTax - legalDeductions;
  
  const dedDependents = rates.payroll.dependents ? Math.min(totalIncomeForTax * 0.1, 32 * uvt) : 0;
  const dedPrepagada = Math.min(rates.payroll.prepagada, 16 * uvt);
  const dedInteresesVivienda = Math.min(rates.payroll.interesesVivienda, 100 * uvt);
  const dedPensionVol = Math.min(rates.payroll.pensionVoluntaria, totalIncomeForTax * 0.3, 3800 * uvt / 12);
  
  const subtotalForExempt25 = netIncome - dedDependents - dedPrepagada - dedInteresesVivienda - dedPensionVol;
  const exempt25 = Math.min(subtotalForExempt25 * 0.25, 65.8 * uvt);
  
  const totalDeductionsAndExemptions = dedDependents + dedPrepagada + dedInteresesVivienda + dedPensionVol + exempt25;
  const cap40Percent = Math.min(netIncome * 0.4, 111.6 * uvt);
  const finalDeductionsAndExemptions = Math.min(totalDeductionsAndExemptions, cap40Percent);
  
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
  const totalGrossWithBenefits = gross + primaProporcional + cesantiasProporcional + interesesCesantias + vacacionesProporcional;
  const net = totalGrossWithBenefits - totalDeductions;
  const netCash = gross - totalDeductions;

  const effectiveDeductionRate = totalGrossWithBenefits > 0 ? totalDeductions / totalGrossWithBenefits : 0;

  return {
    gross,
    totalPatrimonial: totalGrossWithBenefits,
    health,
    pension,
    arl,
    caja,
    fsp,
    retefuente,
    additionalDeductions: sumAdditionalDeductions,
    totalDeductions,
    net,
    netCash,
    primaProporcional,
    cesantiasProporcional,
    interesesCesantias,
    vacacionesProporcional,
    ibc,
    totalMonthlyHours: hoursBreakdown.day + hoursBreakdown.night + hoursBreakdown.holidayDay + hoursBreakdown.holidayNight +
                       hoursBreakdown.extraDay + hoursBreakdown.extraNight + hoursBreakdown.extraHolidayDay + hoursBreakdown.extraHolidayNight,
    totalMonthlyAVA: avaVirtualBreakdown.day + avaVirtualBreakdown.night + avaVirtualBreakdown.holidayDay + avaVirtualBreakdown.holidayNight +
                     avaVirtualBreakdown.extraDay + avaVirtualBreakdown.extraNight + avaVirtualBreakdown.extraHolidayDay + avaVirtualBreakdown.extraHolidayNight,
    totalAccumulatedHours: (hoursBreakdown.day + hoursBreakdown.night + hoursBreakdown.holidayDay + hoursBreakdown.holidayNight +
                            hoursBreakdown.extraDay + hoursBreakdown.extraNight + hoursBreakdown.extraHolidayDay + hoursBreakdown.extraHolidayNight) + 
                           (avaVirtualBreakdown.day + avaVirtualBreakdown.night + avaVirtualBreakdown.holidayDay + avaVirtualBreakdown.holidayNight +
                            avaVirtualBreakdown.extraDay + avaVirtualBreakdown.extraNight + avaVirtualBreakdown.extraHolidayDay + avaVirtualBreakdown.extraHolidayNight),
    totalRegularHours,
    totalExtraHours,
    trisemanaBreakdown,
    recordDistributions,
    totalMonthlyPatients: patientsBreakdown.day + patientsBreakdown.night + patientsBreakdown.holidayDay + patientsBreakdown.holidayNight,
    hoursBreakdown,
    hoursValues,
    avaBreakdown: avaVirtualBreakdown,
    avaValues: avaVirtualValues,
    patientsBreakdown,
    patientsValues,
    monthlyHours,
    legalDeductions,
    totalH,
    totalP,
    totalAVA,
    effectiveDeductionRate,
    avg6,
    avg12
  };
};

function MainApp() {
  console.log("MainApp: Rendering...");
  // --- Auth & State ---
  const { user, isAuthReady, authError, isLoggingIn, login, logout, setAuthError } = useAuth();

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
    isVirtualShift: false,
    isExtraShift: false,
    extraHoursType: 'consultation'
  });
  const [manualTrisemanaId, setManualTrisemanaId] = useState<string | null>(null);
  const [quantities, setQuantities] = useState<Quantities>({
    hours: { day: 0, night: 0, holidayDay: 0, holidayNight: 0, extraDay: 0, extraNight: 0, extraHolidayDay: 0, extraHolidayNight: 0 },
    ava: { day: 0, night: 0, holidayDay: 0, holidayNight: 0, extraDay: 0, extraNight: 0, extraHolidayDay: 0, extraHolidayNight: 0 },
    patients: { day: 0, night: 0, holidayDay: 0, holidayNight: 0 },
    applyPatients: true,
  });
  const [records, setRecords] = useState<ShiftRecord[]>([]);
  const [allRecords, setAllRecords] = useState<ShiftRecord[]>([]);
  const [trisemanas, setTrisemanas] = useState<Trisemana[]>([]);
  const [showTrisemanaModal, setShowTrisemanaModal] = useState(false);
  const [additionalDeductions, setAdditionalDeductions] = useState<Deduction[]>([]);
  const [periods, setPeriods] = useState<BillingPeriod[]>([]);
  const [activePeriod, setActivePeriod] = useState<BillingPeriod | null>(null);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);
  const [showPeriodModal, setShowPeriodModal] = useState(false);
  const [newTrisemanaData, setNewTrisemanaData] = useState({
    name: '',
    startDate: new Date().toISOString().split('T')[0],
    endDate: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    maxHours: 132
  });
  const [showHelp, setShowHelp] = useState<{ title: string, content: string } | null>(null);

  const [editingPeriod, setEditingPeriod] = useState<BillingPeriod | null>(null);
  const [newPeriodData, setNewPeriodData] = useState({
    name: '',
    startDate: '',
    endDate: '',
    extraThreshold: 160
  });

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

    // Sync Trisemanas
    const trisemanasPath = `users/${user.uid}/trisemanas`;
    const unsubscribeTrisemanas = onSnapshot(collection(db, trisemanasPath), (snapshot) => {
      const trisemanasData = snapshot.docs.map(doc => doc.data() as Trisemana);
      setTrisemanas(trisemanasData.sort((a, b) => b.startDate.localeCompare(a.startDate)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, trisemanasPath);
    });

    return () => {
      unsubscribePeriods();
      unsubscribeTrisemanas();
    };
  }, [isAuthReady, user]);

  useEffect(() => {
    if (!isAuthReady || !user) {
      setAllRecords([]);
      return;
    }

    const recordsPath = `users/${user.uid}/records`;
    const unsubscribeAllRecords = onSnapshot(collection(db, recordsPath), (snapshot) => {
      const recordsData = snapshot.docs.map(doc => doc.data() as ShiftRecord);
      setAllRecords(sortRecords(recordsData));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, recordsPath);
    });

    return () => unsubscribeAllRecords();
  }, [isAuthReady, user]);

  useEffect(() => {
    if (!isAuthReady || !user || !selectedPeriodId) {
      setRecords([]);
      setAdditionalDeductions([]);
      return;
    }

    const recordsData = allRecords.filter(r => r.periodId === selectedPeriodId);
    setRecords(sortRecords(recordsData));

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
      unsubscribeDeductions();
    };
  }, [isAuthReady, user, selectedPeriodId, allRecords]);
  useEffect(() => {
    if (!user || !selectedPeriodId) {
      setViewingArchive(null);
      return;
    }

    const period = periods.find(p => p.id === selectedPeriodId);
    if (period && period.status === 'archived') {
      setViewingArchive({
        id: period.id,
        name: period.name,
        timestamp: period.createdAt,
        records: records,
        rates: period.rates || rates,
        additionalDeductions: additionalDeductions
      });
    } else {
      setViewingArchive(null);
    }
  }, [selectedPeriodId, periods, records, additionalDeductions, user, rates]);

  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [showDetails, setShowDetails] = useState(false);
  const [savedCalculations, setSavedCalculations] = useState<SavedCalculation[]>(() => {
    try {
      const saved = localStorage.getItem('med_payroll_saved');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [calcName, setCalcName] = useState('');
  const [autoCalculatePatients, setAutoCalculatePatients] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewingArchive, setViewingArchive] = useState<SavedCalculation | null>(null);
  const [selectedRecordIds, setSelectedRecordIds] = useState<string[]>([]);
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' | 'info' } | null>(null);
  const [showPeriodSelectionModal, setShowPeriodSelectionModal] = useState(false);
  const [showAccumulatedDetails, setShowAccumulatedDetails] = useState(false);
  const [showAccumulatedComponents, setShowAccumulatedComponents] = useState(false);
  const [showProjectionDetails, setShowProjectionDetails] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    message: string;
    onConfirm: () => void;
  } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Save to localStorage whenever savedCalculations changes
  useEffect(() => {
    localStorage.setItem('med_payroll_saved', JSON.stringify(savedCalculations));
  }, [savedCalculations]);

  // --- Correction 5: Period Synchronization ---
  useEffect(() => {
    if (!selectedPeriodId && activePeriod) {
      setSelectedPeriodId(activePeriod.id);
    } else if (selectedPeriodId && !periods.find(p => p.id === selectedPeriodId)) {
      // El periodo seleccionado ya no existe, caer al activo
      setSelectedPeriodId(activePeriod?.id || (periods[0]?.id ?? null));
    }
  }, [periods, activePeriod, selectedPeriodId]);

  // --- Logic: Calculate Hours Distribution ---
  // --- Shift Distribution Logic ---
  const autoCalculatedDistribution = useMemo(() => {
    if (editingId && viewingArchive) return null;

    // 1. Find if this shift falls into a trisemana
    const trisemana = manualTrisemanaId 
      ? trisemanas.find(t => t.id === manualTrisemanaId)
      : trisemanas.find(t => shift.date >= t.startDate && shift.date <= t.endDate);
    
    let threshold = 0;
    let cumulative = 0;

    if (trisemana) {
      threshold = trisemana.maxHours;
      // Calculate cumulative hours in this trisemana before this shift
      const previousInTri = allRecords
        .filter(r => r.date >= trisemana.startDate && r.date <= trisemana.endDate && (r.date < shift.date || (r.date === shift.date && r.startTime < shift.startTime)))
        .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
      
      let triCumulative = 0;
      previousInTri.forEach(r => {
        const rem = Math.max(0, trisemana.maxHours - triCumulative);
        const d = calculateShiftDistribution({
          startTime: r.startTime,
          endTime: r.endTime,
          isHolidayStart: r.isHolidayStart || false,
          isHolidayEnd: r.isHolidayEnd || false,
          isExtraShift: r.isExtraShift || false
        }, rates, rem);
        triCumulative += (d.ord.day + d.ord.night + d.ord.holidayDay + d.ord.holidayNight);
      });
      cumulative = triCumulative;
    } else {
      const currentPeriod = periods.find(p => p.id === selectedPeriodId);
      threshold = currentPeriod?.extraThreshold || 0;
      
      // Calculate cumulative hours in current period before this shift
      const previousInPeriod = records
        .filter(r => r.date < shift.date || (r.date === shift.date && r.startTime < shift.startTime))
        .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
      
      let periodCumulative = 0;
      previousInPeriod.forEach(r => {
        const rem = threshold > 0 ? Math.max(0, threshold - periodCumulative) : 999999;
        const d = calculateShiftDistribution({
          startTime: r.startTime,
          endTime: r.endTime,
          isHolidayStart: r.isHolidayStart || false,
          isHolidayEnd: r.isHolidayEnd || false,
          isExtraShift: r.isExtraShift || false
        }, rates, rem);
        periodCumulative += (d.ord.day + d.ord.night + d.ord.holidayDay + d.ord.holidayNight);
      });
      cumulative = periodCumulative;
    }

    const remaining = threshold > 0 ? Math.max(0, threshold - cumulative) : (trisemana ? 0 : 999999);
    const dist = calculateShiftDistribution(shift, rates, remaining);

    const h = {
      day: dist.ord.day,
      night: dist.ord.night,
      holidayDay: dist.ord.holidayDay,
      holidayNight: dist.ord.holidayNight,
      extraDay: dist.extra.day,
      extraNight: dist.extra.night,
      extraHolidayDay: dist.extra.holidayDay,
      extraHolidayNight: dist.extra.holidayNight,
      trisemanaId: trisemana?.id || null
    };

    return { h, isSpecial: shift.isAVAShift || shift.isVirtualShift };
  }, [shift.startTime, shift.endTime, shift.date, shift.isHolidayStart, shift.isHolidayEnd, shift.isAVAShift, shift.isVirtualShift, shift.isExtraShift, rates, selectedPeriodId, periods, records, allRecords, trisemanas, editingId, viewingArchive]);

  useEffect(() => {
    if (!autoCalculatedDistribution) return;

    const { h, isSpecial } = autoCalculatedDistribution;

    setQuantities(prev => {
      const zeroHours = { 
        day: 0, night: 0, holidayDay: 0, holidayNight: 0,
        extraDay: 0, extraNight: 0, extraHolidayDay: 0, extraHolidayNight: 0
      };

      return {
        ...prev,
        hours: isSpecial ? zeroHours : h,
        ava: shift.isAVAShift ? h : zeroHours,
        // We'll reuse the 'ava' bucket for Virtual shifts in the state for now, 
        // but the calculation logic in calculatePeriodTotals will handle them correctly
        patients: (autoCalculatePatients && !isSpecial) ? {
          day: h.day, night: h.night, holidayDay: h.holidayDay, holidayNight: h.holidayNight
        } : (isSpecial ? { day: 0, night: 0, holidayDay: 0, holidayNight: 0 } : prev.patients),
        applyPatients: isSpecial ? false : prev.applyPatients
      };
    });
  }, [autoCalculatedDistribution, autoCalculatePatients, shift.isAVAShift]);

  // --- Actions ---
  const savePeriod = async () => {
    if (!user) return;
    if (!newPeriodData.startDate || !newPeriodData.endDate) {
      showToast('Por favor, ingresa las fechas de inicio y fin.', 'error');
      return;
    }

    const trimmedName = newPeriodData.name.trim();
    if (trimmedName) {
      const duplicate = periods.find(p => 
        p.name.trim().toLowerCase() === trimmedName.toLowerCase() && 
        (!editingPeriod || p.id !== editingPeriod.id)
      );
      if (duplicate) {
        showToast('Ya existe un periodo con ese nombre. Por favor, elige otro.', 'error');
        return;
      }
    }

    if (newPeriodData.startDate > newPeriodData.endDate) {
      showToast('La fecha de inicio no puede ser posterior a la fecha de fin.', 'error');
      return;
    }

    // Validar solapamiento con periodos existentes (solo para periodos nuevos)
    if (!editingPeriod) {
      const overlap = periods.find(p =>
        p.id !== editingPeriod?.id &&
        newPeriodData.startDate <= p.endDate &&
        newPeriodData.endDate >= p.startDate
      );
      if (overlap) {
        showToast(`Las fechas se solapan con el periodo "${overlap.name}". Ajusta las fechas.`, 'error');
        return;
      }
    }

    try {
      if (editingPeriod) {
        const path = `users/${user.uid}/periods/${editingPeriod.id}`;
        await updateDoc(doc(db, path), {
          name: trimmedName || `Periodo ${newPeriodData.startDate} - ${newPeriodData.endDate}`,
          startDate: newPeriodData.startDate,
          endDate: newPeriodData.endDate,
          extraThreshold: newPeriodData.extraThreshold,
          updatedAt: new Date().toISOString()
        });
        showToast('Periodo actualizado con éxito.');
      } else {
        const periodId = crypto.randomUUID();
        const newPeriod: BillingPeriod = {
          id: periodId,
          userId: user.uid,
          name: trimmedName || `Periodo ${newPeriodData.startDate} - ${newPeriodData.endDate}`,
          startDate: newPeriodData.startDate,
          endDate: newPeriodData.endDate,
          status: 'active',
          createdAt: new Date().toISOString(),
          extraThreshold: newPeriodData.extraThreshold,
          rates: { ...rates }
        };

        const path = `users/${user.uid}/periods/${periodId}`;
        
        // If there's an active period, archive it first
        if (activePeriod) {
          // Se recalculan los totales directamente desde Firestore para garantizar
          // que corresponden al periodo activo, sin depender del estado de la UI.
          const activeRecordsPath = `users/${user.uid}/records`;
          const activeQ = query(collection(db, activeRecordsPath), where('periodId', '==', activePeriod.id));
          const activeSnap = await getDocs(activeQ);
          const activeRecords = activeSnap.docs.map(d => d.data() as ShiftRecord);

          const activeDedPath = `users/${user.uid}/deductions`;
          const activeDedQ = query(collection(db, activeDedPath), where('periodId', '==', activePeriod.id));
          const activeDedSnap = await getDocs(activeDedQ);
          const activeDeductions = activeDedSnap.docs.map(d => d.data() as Deduction);

          const archiveTotals = calculatePeriodTotals(
            activeRecords,
            activePeriod.rates || rates,
            activeDeductions,
            periods,
            activePeriod.id
          );

          await updateDoc(doc(db, `users/${user.uid}/periods/${activePeriod.id}`), {
            status: 'archived',
            totalGross: archiveTotals.gross,
            totalGrossWithBenefits: archiveTotals.totalPatrimonial,
            totalDeductions: archiveTotals.totalDeductions,
            net: archiveTotals.net,
            primaProporcional: archiveTotals.primaProporcional,
            vacacionesProporcional: archiveTotals.vacacionesProporcional,
            cesantiasProporcional: archiveTotals.cesantiasProporcional,
            interesesCesantias: archiveTotals.interesesCesantias,
            rates: { ...rates }
          });
        }
        
        await setDoc(doc(db, path), newPeriod);
        setSelectedPeriodId(periodId);
        showToast('Nuevo periodo iniciado con éxito.');
      }
      
      setShowPeriodModal(false);
      setEditingPeriod(null);
      setNewPeriodData({ name: '', startDate: '', endDate: '', extraThreshold: 160 });
    } catch (error) {
      handleFirestoreError(error, editingPeriod ? OperationType.UPDATE : OperationType.CREATE, `users/${user.uid}/periods`);
    }
  };

  const openEditPeriod = (period: BillingPeriod) => {
    setEditingPeriod(period);
    setNewPeriodData({
      name: period.name,
      startDate: period.startDate,
      endDate: period.endDate,
      extraThreshold: period.extraThreshold || 160
    });
    setShowPeriodModal(true);
  };

  const createTrisemana = async () => {
    if (!user) return;
    
    try {
      // Archive previous trisemanas
      const activeTrisemanas = trisemanas.filter(t => t.status === 'active');
      for (const t of activeTrisemanas) {
        await updateDoc(doc(db, `users/${user.uid}/trisemanas/${t.id}`), {
          status: 'archived'
        });
      }

      const id = crypto.randomUUID();
      const trisemana: Trisemana = {
        id,
        userId: user.uid,
        name: newTrisemanaData.name || `Trisemana ${newTrisemanaData.startDate}`,
        startDate: newTrisemanaData.startDate,
        endDate: newTrisemanaData.endDate,
        maxHours: newTrisemanaData.maxHours,
        status: 'active',
        createdAt: new Date().toISOString()
      };

      const path = `users/${user.uid}/trisemanas/${id}`;
      await setDoc(doc(db, path), trisemana);
      setShowTrisemanaModal(false);
      setNewTrisemanaData({
        name: '',
        startDate: new Date().toISOString().split('T')[0],
        endDate: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        maxHours: 132
      });
      showToast("Trisemana creada con éxito.");
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `users/${user.uid}/trisemanas`);
    }
  };

  const addRecord = async () => {
    if (!user) return;
    if (!selectedPeriodId) {
      showToast('Por favor, inicia un periodo de facturación primero.', 'error');
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
      isExtraShift: shift.isExtraShift,
      isHolidayStart: shift.isHolidayStart,
      isHolidayEnd: shift.isHolidayEnd,
      isAVAShift: shift.isAVAShift,
      isVirtualShift: shift.isVirtualShift,
      extraHoursType: shift.extraHoursType,
      trisemanaId: manualTrisemanaId || autoCalculatedDistribution?.h.trisemanaId || null,
    };

    if (viewingArchive) {
      // Si el archivo corresponde a un periodo en Firestore, persiste el cambio allí.
      const isFirestorePeriod = periods.some(p => p.id === viewingArchive.id);
      if (isFirestorePeriod) {
        const path = `users/${user.uid}/records/${recordId}`;
        try {
          await setDoc(doc(db, path), newRecord);
        } catch (error) {
          handleFirestoreError(error, editingId ? OperationType.UPDATE : OperationType.CREATE, path);
          return;
        }
      }

      const updatedRecords = editingId
        ? viewingArchive.records.map(r => r.id === editingId ? newRecord : r)
        : [...viewingArchive.records, newRecord];

      setViewingArchive({
        ...viewingArchive,
        records: sortRecords(updatedRecords)
      });

      setEditingId(null);
      setManualTrisemanaId(null);
      setShift({
        date: new Date().toISOString().split('T')[0],
        startTime: '07:00',
        endTime: '19:00',
        isHolidayStart: false,
        isHolidayEnd: false,
        isAVAShift: false,
        isVirtualShift: false,
        isExtraShift: false,
        extraHoursType: 'consultation'
      });
      setQuantities({
        hours: { day: 0, night: 0, holidayDay: 0, holidayNight: 0, extraDay: 0, extraNight: 0, extraHolidayDay: 0, extraHolidayNight: 0 },
        ava: { day: 0, night: 0, holidayDay: 0, holidayNight: 0, extraDay: 0, extraNight: 0, extraHolidayDay: 0, extraHolidayNight: 0 },
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
      setManualTrisemanaId(null);
      setShift({
        date: new Date().toISOString().split('T')[0],
        startTime: '07:00',
        endTime: '19:00',
        isHolidayStart: false,
        isHolidayEnd: false,
        isAVAShift: false,
        isVirtualShift: false,
        isExtraShift: false,
        extraHoursType: 'consultation',
      });
      setQuantities({
        hours: { day: 0, night: 0, holidayDay: 0, holidayNight: 0, extraDay: 0, extraNight: 0, extraHolidayDay: 0, extraHolidayNight: 0 },
        ava: { day: 0, night: 0, holidayDay: 0, holidayNight: 0, extraDay: 0, extraNight: 0, extraHolidayDay: 0, extraHolidayNight: 0 },
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
      const isFirestorePeriod = periods.some(p => p.id === viewingArchive.id);
      if (isFirestorePeriod) {
        const path = `users/${user.uid}/records/${id}`;
        try {
          await deleteDoc(doc(db, path));
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, path);
          return;
        }
      }
      setViewingArchive({
        ...viewingArchive,
        records: viewingArchive.records.filter(r => r.id !== id)
      });
      setSelectedRecordIds(prev => prev.filter(rid => rid !== id));
      return;
    }

    const path = `users/${user.uid}/records/${id}`;
    try {
      await deleteDoc(doc(db, path));
      setSelectedRecordIds(prev => prev.filter(rid => rid !== id));
      
      // --- Correction 2: Recalculate totalGross in Firestore ---
      if (selectedPeriodId) {
        const recordsPath = `users/${user.uid}/records`;
        const q = query(collection(db, recordsPath), where('periodId', '==', selectedPeriodId));
        const snapshot = await getDocs(q);
        const remainingRecords = snapshot.docs.map(doc => doc.data() as ShiftRecord);
        
        const period = periods.find(p => p.id === selectedPeriodId);
        const calcRates = period?.rates || rates;
        
        const newTotals = calculatePeriodTotals(remainingRecords, calcRates, additionalDeductions, periods, selectedPeriodId);
        
        await updateDoc(doc(db, `users/${user.uid}/periods/${selectedPeriodId}`), { 
          totalGross: newTotals.gross,
          totalGrossWithBenefits: newTotals.totalPatrimonial,
          totalDeductions: newTotals.totalDeductions,
          net: newTotals.net,
          primaProporcional: newTotals.primaProporcional,
          vacacionesProporcional: newTotals.vacacionesProporcional
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  };

  const deleteSelectedRecords = async () => {
    if (selectedRecordIds.length === 0) return;
    
    setConfirmDialog({
      message: `¿Estás seguro de que deseas eliminar ${selectedRecordIds.length} registros seleccionados?`,
      onConfirm: async () => {
        if (!user) return;
        try {
          const batch = writeBatch(db);
          for (const id of selectedRecordIds) {
            const path = `users/${user.uid}/records/${id}`;
            batch.delete(doc(db, path));
          }
          await batch.commit();
          
          if (selectedPeriodId) {
            const recordsPath = `users/${user.uid}/records`;
            const q = query(collection(db, recordsPath), where('periodId', '==', selectedPeriodId));
            const snapshot = await getDocs(q);
            const remainingRecords = snapshot.docs.map(doc => doc.data() as ShiftRecord);
            
            const period = periods.find(p => p.id === selectedPeriodId);
            const calcRates = period?.rates || rates;
            
            const newTotals = calculatePeriodTotals(remainingRecords, calcRates, additionalDeductions, periods, selectedPeriodId);
            
            await updateDoc(doc(db, `users/${user.uid}/periods/${selectedPeriodId}`), { 
              totalGross: newTotals.gross,
              totalGrossWithBenefits: newTotals.totalPatrimonial,
              totalDeductions: newTotals.totalDeductions,
              net: newTotals.net,
              primaProporcional: newTotals.primaProporcional,
              vacacionesProporcional: newTotals.vacacionesProporcional
            });
          }

          setSelectedRecordIds([]);
          showToast(`${selectedRecordIds.length} registros eliminados con éxito.`);
        } catch (error) {
          console.error("Error deleting multiple records:", error);
          showToast("Ocurrió un error al eliminar algunos registros.", 'error');
        }
      }
    });
  };

  const toggleSelectRecord = (id: string) => {
    setSelectedRecordIds(prev => 
      prev.includes(id) ? prev.filter(rid => rid !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    const currentRecords = viewingArchive ? viewingArchive.records : records;
    if (selectedRecordIds.length === currentRecords.length) {
      setSelectedRecordIds([]);
    } else {
      setSelectedRecordIds(currentRecords.map(r => r.id));
    }
  };

  const updatePeriodTotalGross = async () => {
    if (!user || !selectedPeriodId) return;
    const period = periods.find(p => p.id === selectedPeriodId);
    if (!period) return;
    
    const path = `users/${user.uid}/periods/${selectedPeriodId}`;
    try {
      await updateDoc(doc(db, path), { totalGross: results.all.gross });
      showToast('Total bruto del periodo actualizado con éxito.');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  };

  const updatePeriodThreshold = async (threshold: number) => {
    if (!user || !selectedPeriodId) return;
    try {
      await updateDoc(doc(db, `users/${user.uid}/periods/${selectedPeriodId}`), {
        extraThreshold: threshold
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}/periods/${selectedPeriodId}`);
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
      showToast('Periodo reactivado con éxito.');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}/periods/${id}`);
    }
  };

  const toggleRecordStatus = async (id: string) => {
    if (!user) return;

    const baseRecords = viewingArchive ? viewingArchive.records : records;
    const record = baseRecords.find(r => r.id === id);
    if (!record) return;

    const newStatus = !record.isDefinitive;

    if (viewingArchive) {
      // Update local state for archive
      setViewingArchive({
        ...viewingArchive,
        records: viewingArchive.records.map(r => 
          r.id === id ? { ...r, isDefinitive: newStatus } : r
        )
      });
      
      // Also update Firestore if it's a real record
      const path = `users/${user.uid}/records/${id}`;
      try {
        await updateDoc(doc(db, path), { isDefinitive: newStatus });
      } catch (error) {
        // Silently fail if record doesn't exist in Firestore (e.g. old local-only records)
      }
      return;
    }

    const path = `users/${user.uid}/records/${id}`;
    try {
      await updateDoc(doc(db, path), { isDefinitive: newStatus });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  };

  const editRecord = (record: ShiftRecord) => {
    setEditingId(record.id);
    setShift({ 
      date: record.date,
      startTime: record.startTime,
      endTime: record.endTime,
      isHolidayStart: record.isHolidayStart || false,
      isHolidayEnd: record.isHolidayEnd || false,
      isAVAShift: record.isAVAShift || false,
      isVirtualShift: record.isVirtualShift || false,
      isExtraShift: record.isExtraShift || false,
      extraHoursType: record.extraHoursType || 'consultation'
    });
    setManualTrisemanaId(record.trisemanaId || null);
    setQuantities({
      hours: { ...record.hours },
      ava: { ...record.ava },
      patients: { ...record.patients },
      applyPatients: record.applyPatients,
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const exportToPDF = () => {
    const doc = new jsPDF();
    const period = periods.find(p => p.id === selectedPeriodId);
    const periodName = period?.name || 'Extracto de Pago';
    const dateRange = period ? `${period.startDate} a ${period.endDate}` : '';
    
    // Header
    doc.setFontSize(20);
    doc.setTextColor(30, 41, 59); // slate-800
    doc.text('EXTRACTO DE PAGO / NÓMINA', 14, 22);
    
    doc.setFontSize(10);
    doc.setTextColor(100, 116, 139); // slate-500
    doc.text(`Generado el: ${new Date().toLocaleString()}`, 14, 30);
    doc.text(`Periodo: ${periodName} (${dateRange})`, 14, 35);
    doc.text(`Cargo: ${rates.payroll.jobTitle}`, 14, 40);
    doc.text(`Usuario: ${user?.email || 'N/A'}`, 14, 45);

    // Summary Table
    const summaryData = [
      ['Concepto', 'Valor'],
      ['Sueldo Básico (Turnos)', formatCurrency(results.definitive.gross)],
      ['Prima Proporcional', formatCurrency(results.definitive.primaProporcional)],
      ['Cesantías Proporcionales', formatCurrency(results.definitive.cesantiasProporcional)],
      ['Intereses Cesantías', formatCurrency(results.definitive.interesesCesantias)],
      ['Vacaciones Proporcionales', formatCurrency(results.definitive.vacacionesProporcional)],
      ['TOTAL PATRIMONIAL', formatCurrency(results.definitive.totalPatrimonial)],
      ['', ''],
      ['Salud (4%)', `-${formatCurrency(results.definitive.health)}`],
      ['Pensión (4%)', `-${formatCurrency(results.definitive.pension)}`],
      ['Caja de Compensación', formatCurrency(results.definitive.caja)],
      ['FSP', results.definitive.fsp > 0 ? `-${formatCurrency(results.definitive.fsp)}` : '$0'],
      ['Retención en la Fuente', results.definitive.retefuente > 0 ? `-${formatCurrency(results.definitive.retefuente)}` : '$0'],
      ['Otras Deducciones', results.definitive.additionalDeductions > 0 ? `-${formatCurrency(results.definitive.additionalDeductions)}` : '$0'],
      ['TOTAL DEDUCCIONES', `-${formatCurrency(results.definitive.totalDeductions)}`],
      ['', ''],
      ['NETO A RECIBIR (CAJA)', formatCurrency(results.definitive.netCash)],
    ];

    (doc as any).autoTable({
      startY: 50,
      head: [summaryData[0]],
      body: summaryData.slice(1),
      theme: 'striped',
      headStyles: { fillColor: [30, 41, 59], textColor: 255 },
      columnStyles: {
        1: { halign: 'right', fontStyle: 'bold' }
      }
    });

    // Detailed Records Table
    doc.addPage();
    doc.setFontSize(16);
    doc.text('DETALLE DE TURNOS', 14, 22);

    const recordsData = (viewingArchive ? viewingArchive.records : records).map(r => {
      const isAVAMain = r.isAVAShift || r.isVirtualShift || (Object.values(r.ava || {}).some(v => v > 0) && Object.values(r.hours || {}).every(v => v === 0));
      const h = isAVAMain ? { day: 0, night: 0, holidayDay: 0, holidayNight: 0, extraDay: 0, extraNight: 0, extraHolidayDay: 0, extraHolidayNight: 0 } : r.hours;
      const a = isAVAMain ? r.ava : { day: 0, night: 0, holidayDay: 0, holidayNight: 0, extraDay: 0, extraNight: 0, extraHolidayDay: 0, extraHolidayNight: 0 };
      
      return [
        r.date,
        `${r.startTime}-${r.endTime}`,
        `${h.day}/${h.night}/${h.holidayDay}/${h.holidayNight}/${h.extraDay}/${h.extraNight}/${h.extraHolidayDay}/${h.extraHolidayNight}`,
        `${a.day}/${a.night}/${a.holidayDay}/${a.holidayNight}/${a.extraDay}/${a.extraNight}/${a.extraHolidayDay}/${a.extraHolidayNight}`,
        r.applyPatients ? `${r.patients.day}/${r.patients.night}/${r.patients.holidayDay}/${r.patients.holidayNight}` : 'N/A',
      ];
    });

    (doc as any).autoTable({
      startY: 30,
      head: [['Fecha', 'Horario', 'H. Consulta', 'H. AVA/Virtual', 'Pacientes']],
      body: recordsData,
      theme: 'grid',
      headStyles: { fillColor: [71, 85, 105], fontSize: 7 },
      styles: { fontSize: 6 }
    });

    doc.save(`Extracto_${periodName.replace(/\s+/g, '_')}.pdf`);
  };

  const exportToCSV = () => {
    const baseRecords = viewingArchive ? viewingArchive.records : records;
    if (baseRecords.length === 0) {
      showToast('No hay registros para exportar.', 'info');
      return;
    }

    const headers = [
      'Fecha', 'Inicio', 'Fin', 'Estado', 'Tipo',
      'H. Diu', 'H. Noc', 'H. F-Diu', 'H. F-Noc', 'H. E-Diu', 'H. E-Noc', 'H. EF-Diu', 'H. EF-Noc',
      'Pac Diu', 'Pac Noc', 'Pac F-Diu', 'Pac F-Noc'
    ];

    const rows = baseRecords.map(r => {
      const isAVAMain = r.isAVAShift || r.isVirtualShift || (Object.values(r.ava || {}).some(v => v > 0) && Object.values(r.hours || {}).every(v => v === 0));
      const q = isAVAMain ? r.ava : r.hours;
      return [
        r.date, r.startTime, r.endTime, r.isDefinitive ? 'Definitivo' : 'Proyección',
        isAVAMain ? 'AVA/Virtual' : 'Consulta',
        q.day, q.night, q.holidayDay, q.holidayNight, q.extraDay, q.extraNight, q.extraHolidayDay, q.extraHolidayNight,
        r.applyPatients ? r.patients.day : 0, 
        r.applyPatients ? r.patients.night : 0, 
        r.applyPatients ? r.patients.holidayDay : 0, 
        r.applyPatients ? r.patients.holidayNight : 0
      ];
    });

    // Add summary
    rows.push([]);
    rows.push(['RESUMEN']);
    rows.push(['Total Bruto (Base)', results.definitive.gross]);
    rows.push(['Prima Proporcional', results.definitive.primaProporcional]);
    rows.push(['Vacaciones Proporcionales', results.definitive.vacacionesProporcional]);
    rows.push(['Total Patrimonial', results.definitive.totalPatrimonial]);
    rows.push(['Deducciones Legales', results.definitive.legalDeductions]);
    rows.push(['Deducciones Adicionales', results.definitive.additionalDeductions]);
    rows.push(['Neto a Pagar (Caja)', results.definitive.netCash]);

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
  const saveCurrentCalculation = () => {
    const baseRecords = viewingArchive ? viewingArchive.records : records;
    if (!calcName.trim()) {
      showToast('Por favor, ingresa un nombre para guardar el extracto.', 'error');
      return;
    }
    if (baseRecords.length === 0) {
      showToast('No hay turnos para guardar.', 'error');
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
    showToast('Extracto guardado con éxito.');
  };

  const loadCalculation = (saved: SavedCalculation) => {
    setViewingArchive({ ...saved });
    setRates(saved.rates);
    setAdditionalDeductions(Array.isArray(saved.additionalDeductions) ? saved.additionalDeductions : []);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const saveUpdatedArchive = async () => {
    if (!user || !viewingArchive) return;
    
    // Check if it's a Firestore period
    const period = periods.find(p => p.id === viewingArchive.id);
    if (period) {
      const path = `users/${user.uid}/periods/${period.id}`;
      try {
        await updateDoc(doc(db, path), {
          totalGross: results.all.gross,
          totalGrossWithBenefits: results.all.totalPatrimonial,
          totalDeductions: results.all.totalDeductions,
          net: results.all.net,
          primaProporcional: results.all.primaProporcional,
          vacacionesProporcional: results.all.vacacionesProporcional,
          cesantiasProporcional: results.all.cesantiasProporcional,
          interesesCesantias: results.all.interesesCesantias,
          updatedAt: new Date().toISOString()
        });
        showToast("Cambios guardados en el periodo.");
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, path);
      }
    } else {
      // Legacy localStorage archive
      const updatedArchives = savedCalculations.map(s => 
        s.id === viewingArchive.id ? { ...viewingArchive, timestamp: new Date().toLocaleString() } : s
      );
      setSavedCalculations(updatedArchives);
      showToast("Cambios guardados en el extracto local.");
    }
  };

  const saveAndClosePeriod = async () => {
    if (!user || !viewingArchive) return;
    await saveUpdatedArchive();
    setShowPeriodSelectionModal(true);
  };

  const deletePeriod = async (periodId: string) => {
    if (!user) return;
    
    setConfirmDialog({
      message: "¿Estás seguro de que deseas eliminar este periodo y todos sus registros asociados? Esta acción no se puede deshacer.",
      onConfirm: async () => {
        try {
          // 1. Delete all records associated with this period
          const recordsPath = `users/${user.uid}/records`;
          const q = query(collection(db, recordsPath), where('periodId', '==', periodId));
          const snapshot = await getDocs(q);
          
          for (const d of snapshot.docs) {
            await deleteDoc(doc(db, `${recordsPath}/${d.id}`));
          }

          // 2. Delete the period itself
          await deleteDoc(doc(db, `users/${user.uid}/periods/${periodId}`));
          
          if (selectedPeriodId === periodId) {
            const remaining = periods.filter(p => p.id !== periodId);
            const nextActive = remaining.find(p => p.status === 'active');
            setSelectedPeriodId(nextActive ? nextActive.id : (remaining[0]?.id || null));
          }
          
          showToast("Periodo y registros eliminados con éxito.");
        } catch (error) {
          console.error("Error deleting period:", error);
          showToast("Error al eliminar el periodo.", "error");
        }
      }
    });
  };

  const deleteTrisemana = async (id: string) => {
    if (!user) return;
    setConfirmDialog({
      message: "¿Estás seguro de que deseas eliminar esta trisemana? Los cálculos de horas extra volverán a usar el límite mensual para este intervalo.",
      onConfirm: async () => {
        const path = `users/${user.uid}/trisemanas/${id}`;
        try {
          await deleteDoc(doc(db, path));
          showToast("Trisemana eliminada correctamente");
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, path);
        }
      }
    });
  };

  const closeArchive = () => {
    setViewingArchive(null);
    // Restore current rates and deductions from live state if needed
    // Actually, rates and deductions are shared for now, but we could restore them if we wanted.
    // For now, just returning to live records is enough.
    showToast('Regresando a la bitácora en vivo.', 'info');
  };

  const deleteSavedCalculation = (id: string) => {
    setConfirmDialog({
      message: '¿Eliminar este extracto guardado?',
      onConfirm: () => {
        setSavedCalculations(savedCalculations.filter(s => s.id !== id));
        showToast('Extracto eliminado.');
      }
    });
  };

  const addDeduction = async () => {
    if (!user || !selectedPeriodId) return;
    const deductionId = crypto.randomUUID();
    // Se guarda con concept inicial válido ('Nueva deducción') para cumplir con las reglas de Firestore.
    // Se incluye userId explícitamente.
    const deduction: Deduction = {
      id: deductionId,
      userId: user.uid,
      concept: 'Nueva deducción',
      amount: 0,
      periodId: selectedPeriodId
    };
    const path = `users/${user.uid}/deductions/${deductionId}`;
    try {
      await setDoc(doc(db, path), deduction);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
      showToast('Error al crear la deducción.', 'error');
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
    const baseRecords = viewingArchive ? viewingArchive.records : records;
    const currentPeriod = periods.find(p => p.id === selectedPeriodId);
    const calculationRates = viewingArchive ? viewingArchive.rates : (currentPeriod?.rates || rates);

    let recordsToCalculate = [...baseRecords];
    let allRecordsToCalculate = [...allRecords];

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
        isExtraShift: shift.isExtraShift,
        isHolidayStart: shift.isHolidayStart,
        isHolidayEnd: shift.isHolidayEnd,
        isAVAShift: shift.isAVAShift,
        isVirtualShift: shift.isVirtualShift,
      };
      recordsToCalculate = recordsToCalculate.map(r => r.id === editingId ? currentFormRecord : r);
      allRecordsToCalculate = allRecordsToCalculate.map(r => r.id === editingId ? currentFormRecord : r);
    }

    const allResults = calculatePeriodTotals(
      recordsToCalculate,
      calculationRates,
      additionalDeductions,
      periods,
      selectedPeriodId,
      allRecordsToCalculate,
      trisemanas
    );

    const definitiveRecords = recordsToCalculate.filter(r => r.isDefinitive);
    const definitiveAllRecords = allRecordsToCalculate.filter(r => r.isDefinitive);

    const definitiveResults = calculatePeriodTotals(
      definitiveRecords,
      calculationRates,
      additionalDeductions,
      periods,
      selectedPeriodId,
      definitiveAllRecords,
      trisemanas
    );

    return {
      all: allResults,
      definitive: definitiveResults,
      calculationRates
    };
  }, [records, viewingArchive, periods, selectedPeriodId, rates, additionalDeductions, editingId, shift, quantities, user, allRecords, trisemanas]);

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
              onClick={login}
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
              onClick={saveAndClosePeriod}
              className="px-4 py-1.5 bg-indigo-600 text-white text-xs font-bold rounded-lg hover:bg-indigo-700 transition-all flex items-center gap-2 shadow-sm"
            >
              <CheckCircle2 className="w-3 h-3" />
              Guardar y Cerrar
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
                      className={`p-3 rounded-xl border transition-all ${selectedPeriodId === activePeriod.id ? 'bg-white border-indigo-300 shadow-sm' : 'bg-indigo-100/50 border-transparent hover:bg-white'}`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span 
                          onClick={() => setSelectedPeriodId(activePeriod.id)}
                          className="text-xs font-bold text-slate-700 cursor-pointer flex-1"
                        >
                          {activePeriod.name}
                        </span>
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={() => deletePeriod(activePeriod.id)}
                            className="p-1 text-slate-400 hover:text-rose-500 transition-colors"
                            title="Eliminar Periodo"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        </div>
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
                    <div className="flex gap-2">
                      <select 
                        value={selectedPeriodId && periods.find(p => p.id === selectedPeriodId)?.status === 'archived' ? selectedPeriodId : ''}
                        onChange={(e) => setSelectedPeriodId(e.target.value)}
                        className="flex-1 bg-white border border-indigo-200 rounded-xl py-2 px-3 text-xs font-bold text-slate-700 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                      >
                        <option value="" disabled>Ver historial...</option>
                        {periods.filter(p => p.status === 'archived').map(p => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                      {selectedPeriodId && periods.find(p => p.id === selectedPeriodId)?.status === 'archived' && (
                        <button 
                          onClick={() => deletePeriod(selectedPeriodId)}
                          className="p-2 bg-white border border-rose-200 text-rose-500 rounded-xl hover:bg-rose-50 transition-all"
                          title="Eliminar Periodo Seleccionado"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </section>

            {/* Trisemanas Section */}
            <section className="bg-amber-50 p-4 rounded-2xl border border-amber-100">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-amber-700">
                  <Clock className="w-4 h-4" />
                  <h2 className="text-xs font-bold uppercase tracking-widest">Trisemanas</h2>
                </div>
                <button 
                  onClick={() => setShowTrisemanaModal(true)}
                  className="p-1.5 bg-white text-amber-600 rounded-lg hover:bg-amber-100 transition-colors shadow-sm border border-amber-200"
                  title="Nueva Trisemana"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
              
              <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1 custom-scrollbar">
                {trisemanas.length === 0 ? (
                  <button 
                    onClick={() => setShowTrisemanaModal(true)}
                    className="w-full py-3 bg-white border border-dashed border-amber-200 text-amber-600 text-xs font-bold rounded-xl hover:bg-amber-100 transition-all flex items-center justify-center gap-2"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Nueva Trisemana
                  </button>
                ) : (
                  trisemanas.sort((a, b) => b.startDate.localeCompare(a.startDate)).map(t => (
                    <div 
                      key={t.id}
                      className={`p-3 rounded-xl border transition-all ${
                        t.status === 'active' 
                          ? 'bg-amber-50 border-amber-200 shadow-sm' 
                          : 'bg-white border-slate-100 opacity-70 hover:opacity-100'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-bold ${t.status === 'active' ? 'text-amber-900' : 'text-slate-700'}`}>
                            {t.name}
                          </span>
                          {t.status === 'active' && (
                            <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          {t.status === 'archived' && (
                            <button 
                              onClick={async () => {
                                if (!user) return;
                                try {
                                  // Archive current active
                                  const active = trisemanas.find(tri => tri.status === 'active');
                                  if (active) {
                                    await updateDoc(doc(db, `users/${user.uid}/trisemanas/${active.id}`), { status: 'archived' });
                                  }
                                  // Activate this one
                                  await updateDoc(doc(db, `users/${user.uid}/trisemanas/${t.id}`), { status: 'active' });
                                  showToast(`Trisemana "${t.name}" activada.`);
                                } catch (error) {
                                  handleFirestoreError(error, OperationType.UPDATE, 'trisemanas');
                                }
                              }}
                              className="p-1 text-slate-300 hover:text-amber-500 transition-colors"
                              title="Activar"
                            >
                              <CheckCircle2 className="w-3 h-3" />
                            </button>
                          )}
                          <button 
                            onClick={() => deleteTrisemana(t.id)}
                            className="p-1 text-slate-300 hover:text-rose-500 transition-colors"
                            title="Eliminar"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] text-slate-500">{t.startDate} al {t.endDate}</span>
                        <span className={`text-[9px] font-bold ${t.status === 'active' ? 'text-amber-600' : 'text-slate-400'}`}>
                          {t.maxHours}h
                        </span>
                      </div>
                    </div>
                  ))
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
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Porcentajes de Recargo (%)</h3>
                  <div className="grid grid-cols-2 gap-4">
                    {[
                      { label: 'Nocturno', key: 'night' },
                      { label: 'Festivo Diurno', key: 'holidayDay' },
                      { label: 'Festivo Nocturno', key: 'holidayNight' },
                      { label: 'Extra Diurno', key: 'extraDay' },
                      { label: 'Extra Nocturno', key: 'extraNight' },
                    ].map((item) => (
                      <div key={item.key}>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">{item.label}</label>
                        <div className="relative">
                          <input 
                            type="number"
                            step="0.01"
                            value={rates.surcharges[item.key as keyof Rates['surcharges']]}
                            onChange={(e) => {
                              const val = Number(e.target.value);
                              const newSurcharges = { ...rates.surcharges, [item.key]: val };
                              
                              // Recalculate all derived rates
                              const b = rates.base;
                              const s = newSurcharges;
                              
                              const updateH = (base: number) => ({
                                day: base,
                                night: Number((base * (1 + s.night)).toFixed(2)),
                                holidayDay: Number((base * (1 + s.holidayDay)).toFixed(2)),
                                holidayNight: Number((base * (1 + s.holidayNight)).toFixed(2)),
                                extraDay: Number((base * (1 + s.extraDay)).toFixed(2)),
                                extraNight: Number((base * (1 + s.extraNight)).toFixed(2)),
                                extraHolidayDay: Number((base * (1 + s.extraDay)).toFixed(2)),
                                extraHolidayNight: Number((base * (1 + s.extraNight)).toFixed(2)),
                              });

                              setRates({
                                ...rates,
                                surcharges: newSurcharges,
                                hourly: updateH(b.consultation),
                                ava: updateH(b.ava),
                                patient: {
                                  day: b.service,
                                  night: Number((b.service * (1 + s.night)).toFixed(2)),
                                  holidayDay: Number((b.service * (1 + s.holidayDay)).toFixed(2)),
                                  holidayNight: Number((b.service * (1 + s.holidayNight)).toFixed(2)),
                                }
                              });
                            }}
                            className="w-full bg-white border border-slate-200 rounded-xl py-2 px-3 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all font-mono"
                          />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs">%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Bases Salariales ($)</h3>
                  <div className="space-y-4">
                    {[
                      { label: 'Base Consulta (Hora)', key: 'consultation' },
                      { label: 'Base Servicio (Hora)', key: 'service' },
                      { label: 'Base AVA/Virtual (Hora)', key: 'ava' },
                    ].map((item) => (
                      <div key={item.key}>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">{item.label}</label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                          <input 
                            type="number"
                            step="0.01"
                            value={rates.base[item.key as keyof Rates['base']]}
                            onChange={(e) => {
                              const val = Number(e.target.value);
                              const newBase = { ...rates.base, [item.key]: val };
                              if (item.key === 'ava') newBase.virtual = val; // Keep them in sync
                              
                              const s = rates.surcharges;
                              const updateH = (base: number) => ({
                                day: base,
                                night: Number((base * (1 + s.night)).toFixed(2)),
                                holidayDay: Number((base * (1 + s.holidayDay)).toFixed(2)),
                                holidayNight: Number((base * (1 + s.holidayNight)).toFixed(2)),
                                extraDay: Number((base * (1 + s.extraDay)).toFixed(2)),
                                extraNight: Number((base * (1 + s.extraNight)).toFixed(2)),
                                extraHolidayDay: Number((base * (1 + s.extraDay)).toFixed(2)),
                                extraHolidayNight: Number((base * (1 + s.extraNight)).toFixed(2)),
                              });

                              setRates({
                                ...rates,
                                base: newBase,
                                hourly: updateH(newBase.consultation),
                                ava: updateH(newBase.ava),
                                patient: {
                                  day: newBase.service,
                                  night: Number((newBase.service * (1 + s.night)).toFixed(2)),
                                  holidayDay: Number((newBase.service * (1 + s.holidayDay)).toFixed(2)),
                                  holidayNight: Number((newBase.service * (1 + s.holidayNight)).toFixed(2)),
                                }
                              });
                            }}
                            className="w-full bg-white border border-slate-200 rounded-xl py-2 pl-7 pr-3 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all font-mono"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Valor Horas Consulta ($)</h3>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-[10px] font-bold text-indigo-500 uppercase mb-1">Base Consulta (Diurna)</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                        <input 
                          type="number" 
                          step="0.01"
                          value={rates.hourly.day}
                          onChange={(e) => {
                            const base = Number(e.target.value);
                            setRates({
                              ...rates,
                              hourly: {
                                day: base,
                                night: Number((base * (1 + rates.surcharges.night)).toFixed(2)),
                                holidayDay: Number((base * (1 + rates.surcharges.holidayDay)).toFixed(2)),
                                holidayNight: Number((base * (1 + rates.surcharges.holidayNight)).toFixed(2)),
                                extraDay: Number((base * (1 + rates.surcharges.extraDay)).toFixed(2)),
                                extraNight: Number((base * (1 + rates.surcharges.extraNight)).toFixed(2)),
                                extraHolidayDay: Number((base * (1 + rates.surcharges.extraHolidayDay)).toFixed(2)),
                                extraHolidayNight: Number((base * (1 + rates.surcharges.extraHolidayNight)).toFixed(2)),
                              }
                            });
                          }}
                          className="w-full bg-white border border-indigo-200 rounded-xl py-2 pl-7 pr-3 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all font-mono font-bold"
                        />
                      </div>
                      <p className="text-[9px] text-slate-400 mt-1 italic">Calcula recargos según configuración superior</p>
                    </div>

                    <div className="h-px bg-slate-200 my-2" />

                    {[
                      { label: 'Consulta Diurna', key: 'day' },
                      { label: 'Consulta Nocturna', key: 'night' },
                      { label: 'Consulta D-Festiva', key: 'holidayDay' },
                      { label: 'Consulta N-Festiva', key: 'holidayNight' },
                      { label: 'Consulta Extra Diurna', key: 'extraDay' },
                      { label: 'Consulta Extra Nocturna', key: 'extraNight' },
                      { label: 'Consulta Extra D-Festiva', key: 'extraHolidayDay' },
                      { label: 'Consulta Extra N-Festiva', key: 'extraHolidayNight' },
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
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Valor Horas AVA/Virtual ($)</h3>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-[10px] font-bold text-indigo-500 uppercase mb-1">Base AVA/Virtual (Diurna)</label>
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
                                night: Number((base * (1 + rates.surcharges.night)).toFixed(2)),
                                holidayDay: Number((base * (1 + rates.surcharges.holidayDay)).toFixed(2)),
                                holidayNight: Number((base * (1 + rates.surcharges.holidayNight)).toFixed(2)),
                                extraDay: Number((base * (1 + rates.surcharges.extraDay)).toFixed(2)),
                                extraNight: Number((base * (1 + rates.surcharges.extraNight)).toFixed(2)),
                                extraHolidayDay: Number((base * (1 + rates.surcharges.extraHolidayDay)).toFixed(2)),
                                extraHolidayNight: Number((base * (1 + rates.surcharges.extraHolidayNight)).toFixed(2)),
                              }
                            });
                          }}
                          className="w-full bg-white border border-indigo-200 rounded-xl py-2 pl-7 pr-3 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all font-mono font-bold"
                        />
                      </div>
                      <p className="text-[9px] text-slate-400 mt-1 italic">Calcula recargos según configuración superior</p>
                    </div>

                    <div className="h-px bg-slate-200 my-2" />

                    {[
                      { label: 'AVA/Virt Diurna', key: 'day' },
                      { label: 'AVA/Virt Nocturna', key: 'night' },
                      { label: 'AVA/Virt D-Festiva', key: 'holidayDay' },
                      { label: 'AVA/Virt N-Festiva', key: 'holidayNight' },
                      { label: 'AVA/Virt Extra Diurna', key: 'extraDay' },
                      { label: 'AVA/Virt Extra Nocturna', key: 'extraNight' },
                      { label: 'AVA/Virt Extra D-Festiva', key: 'extraHolidayDay' },
                      { label: 'AVA/Virt Extra N-Festiva', key: 'extraHolidayNight' },
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
                      <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Cargo / Título</label>
                      <input 
                        type="text"
                        value={rates.payroll.jobTitle}
                        onChange={(e) => setRates({
                          ...rates,
                          payroll: { ...rates.payroll, jobTitle: e.target.value }
                        })}
                        className="w-full bg-white border border-slate-200 rounded-xl py-2 px-3 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                        placeholder="Ej: MEDICO CONSULTA 2 MED"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1 flex items-center gap-1">
                        Valor UVT 2026
                        <button 
                          onClick={() => setShowHelp(HELP_CONTENT.uvt)}
                          className="hover:text-indigo-600 transition-colors"
                        >
                          <Info className="w-3 h-3 text-slate-400" />
                        </button>
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
                          <button 
                            onClick={() => setShowHelp(HELP_CONTENT.cutoff)}
                            className="hover:text-indigo-600 transition-colors"
                          >
                            <Info className="w-3 h-3 text-slate-400" />
                          </button>
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
                          <button 
                            onClick={() => setShowHelp(HELP_CONTENT.dependents)}
                            className="hover:text-indigo-600 transition-colors"
                          >
                            <Info className="w-3 h-3 text-slate-400" />
                          </button>
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
                          <button 
                            onClick={() => setShowHelp(HELP_CONTENT.nightShift)}
                            className="hover:text-indigo-600 transition-colors"
                          >
                            <Info className="w-3 h-3 text-slate-400" />
                          </button>
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
                        <button 
                          onClick={() => setShowHelp(HELP_CONTENT.prepagada)}
                          className="hover:text-indigo-600 transition-colors"
                        >
                          <Info className="w-3 h-3 text-slate-400" />
                        </button>
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
                        <button 
                          onClick={() => setShowHelp(HELP_CONTENT.interesesVivienda)}
                          className="hover:text-indigo-600 transition-colors"
                        >
                          <Info className="w-3 h-3 text-slate-400" />
                        </button>
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
                        <button 
                          onClick={() => setShowHelp(HELP_CONTENT.pensionVoluntaria)}
                          className="hover:text-indigo-600 transition-colors"
                        >
                          <Info className="w-3 h-3 text-slate-400" />
                        </button>
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
                    <div className="p-3 bg-indigo-50 rounded-xl border border-indigo-100 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-indigo-600 uppercase">Retención Estimada</span>
                        <span className="text-xs font-bold text-indigo-700">{formatCurrency(results.all.retefuente)}</span>
                      </div>
                      <p className="text-[9px] text-indigo-400 italic leading-tight">
                        Calculada sobre el Ingreso Salarial actual aplicando tus parámetros manuales y el tope del 40%.
                      </p>
                    </div>
                    <div className="h-px bg-slate-200 my-2" />
                    <div>
                      <label className="block text-[10px] font-bold text-indigo-500 uppercase mb-1 flex items-center gap-1">
                        Promedio Facturado 12 Meses ($)
                        <button 
                          onClick={() => setShowHelp(HELP_CONTENT.avgBilling)}
                          className="hover:text-indigo-600 transition-colors"
                        >
                          <Info className="w-3 h-3 text-indigo-400" />
                        </button>
                      </label>
                      <div className="w-full bg-indigo-50 border border-indigo-100 rounded-xl py-2 px-3 text-sm font-mono text-indigo-700 flex items-center justify-between">
                        <span>{formatCurrency(results.all.avg12)}</span>
                        <button
                          onClick={() => {
                            const today = new Date().toISOString().split('T')[0];
                            setRates({
                              ...rates,
                              payroll: { ...rates.payroll, vacationLastResetDate: today }
                            });
                            showToast("Ciclo de vacaciones reiniciado correctamente");
                          }}
                          className="text-[9px] bg-indigo-600 text-white px-2 py-1 rounded-lg hover:bg-indigo-700 transition-colors uppercase font-bold"
                        >
                          Reiniciar Ciclo
                        </button>
                      </div>
                      <p className="text-[9px] text-indigo-400 mt-1 italic flex items-center justify-between">
                        <span>
                          {rates.payroll.vacationLastResetDate 
                            ? `Reiniciado el: ${rates.payroll.vacationLastResetDate}` 
                            : "Calculado automáticamente (últimos 12 meses)"}
                        </span>
                        {rates.payroll.vacationLastResetDate && (
                          <button
                            onClick={() => {
                              setRates({
                                ...rates,
                                payroll: { ...rates.payroll, vacationLastResetDate: null }
                              });
                              showToast("Cálculo de vacaciones vuelto a automático");
                            }}
                            className="text-indigo-600 hover:underline font-bold"
                          >
                            Limpiar
                          </button>
                        )}
                      </p>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-indigo-500 uppercase mb-1 flex items-center gap-1">
                        Promedio Facturado 6 Meses (Semestre) ($)
                        <button 
                          onClick={() => setShowHelp(HELP_CONTENT.avgBilling)}
                          className="hover:text-indigo-600 transition-colors"
                        >
                          <Info className="w-3 h-3 text-indigo-400" />
                        </button>
                      </label>
                      <div className="w-full bg-indigo-50 border border-indigo-100 rounded-xl py-2 px-3 text-sm font-mono text-indigo-700">
                        {formatCurrency(results.all.avg6)}
                      </div>
                      <p className="text-[9px] text-indigo-400 mt-1 italic">Calculado automáticamente del historial</p>
                    </div>
                  </div>

                  <div className="mt-6 pt-6 border-t border-indigo-100">
                    <div className="flex items-center justify-between p-4 bg-indigo-50 rounded-2xl border border-indigo-100">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest">Aportar sobre el Mínimo</span>
                        <button 
                          onClick={() => setShowHelp(HELP_CONTENT.ibcMinimo)}
                          className="text-indigo-400 hover:text-indigo-600 transition-colors"
                        >
                          <Info className="w-3 h-3" />
                        </button>
                      </div>
                      <button
                        onClick={() => setRates({
                          ...rates,
                          payroll: { ...rates.payroll, ibcMinimo: !rates.payroll.ibcMinimo }
                        })}
                        className={`w-10 h-5 rounded-full transition-all relative ${rates.payroll.ibcMinimo ? 'bg-indigo-600' : 'bg-slate-300'}`}
                      >
                        <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${rates.payroll.ibcMinimo ? 'right-1' : 'left-1'}`} />
                      </button>
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
                <div className="space-y-4">
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
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">Trisemana (Periodo)</label>
                    <select 
                      value={manualTrisemanaId || ""}
                      onChange={(e) => setManualTrisemanaId(e.target.value || null)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-amber-500 outline-none transition-all font-bold text-slate-700"
                    >
                      <option value="">Auto-detectar por fecha</option>
                      {trisemanas.map(t => (
                        <option key={t.id} value={t.id}>{t.name} ({t.startDate})</option>
                      ))}
                    </select>
                    {(() => {
                      const t = manualTrisemanaId 
                        ? trisemanas.find(tri => tri.id === manualTrisemanaId)
                        : trisemanas.find(tri => shift.date >= tri.startDate && shift.date <= tri.endDate);
                      return t ? (
                        <div className="flex items-center gap-1.5 px-2 py-1 bg-amber-50 border border-amber-100 rounded-lg">
                          <Clock className="w-3 h-3 text-amber-600" />
                          <span className="text-[10px] font-bold text-amber-700 uppercase truncate">{t.name}</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 px-2 py-1 bg-rose-50 border border-rose-100 rounded-lg animate-pulse">
                          <AlertCircle className="w-3 h-3 text-rose-500" />
                          <span className="text-[10px] font-bold text-rose-600 uppercase">Sin Trisemana</span>
                        </div>
                      );
                    })()}
                  </div>
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
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Atribución de Horas</span>
                    <div className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${shift.isAVAShift ? 'bg-amber-100 text-amber-700' : 'bg-indigo-100 text-indigo-700'}`}>
                      {shift.isAVAShift ? 'AVA/Virtual' : 'Consulta'}
                    </div>
                  </div>
                  
                  <div className="flex gap-2 mb-4">
                    {[
                      { id: 'consultation', label: 'Consulta', icon: Users, color: 'indigo' },
                      { id: 'avaVirtual', label: 'AVA/Virtual', icon: TrendingUp, color: 'amber' },
                    ].map((type) => (
                      <button
                        key={type.id}
                        onClick={() => {
                          setShift({ 
                            ...shift, 
                            isAVAShift: type.id === 'avaVirtual',
                            isVirtualShift: false,
                            extraHoursType: type.id as 'consultation' | 'avaVirtual'
                          });
                          if (type.id !== 'consultation') {
                            setQuantities(prev => ({ 
                              ...prev, 
                              applyPatients: false,
                              patients: { day: 0, night: 0, holidayDay: 0, holidayNight: 0 }
                            }));
                          }
                        }}
                        className={`flex-1 flex flex-col items-center justify-center gap-2 py-3 px-2 rounded-2xl text-xs font-bold uppercase transition-all border-2 ${
                          (type.id === 'consultation' && !shift.isAVAShift) ||
                          (type.id === 'avaVirtual' && shift.isAVAShift)
                            ? type.id === 'consultation' 
                              ? 'bg-indigo-600 text-white border-indigo-600 shadow-md scale-[1.02]' 
                              : 'bg-amber-500 text-white border-amber-500 shadow-md scale-[1.02]'
                            : 'bg-white text-slate-400 border-slate-100 hover:border-slate-200'
                        }`}
                      >
                        <type.icon className="w-5 h-5" />
                        {type.label}
                      </button>
                    ))}
                  </div>

                  <div className="grid grid-cols-2 gap-x-6 gap-y-2 bg-white/50 p-3 rounded-xl border border-slate-100">
                    <div className="text-[10px] font-bold text-slate-400 uppercase">Diurnas: <span className={`${shift.isAVAShift ? 'text-amber-600' : 'text-indigo-600'} font-mono text-sm ml-1`}>{shift.isAVAShift ? quantities.ava.day : quantities.hours.day}h</span></div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase">Nocturnas: <span className={`${shift.isAVAShift ? 'text-amber-600' : 'text-indigo-600'} font-mono text-sm ml-1`}>{shift.isAVAShift ? quantities.ava.night : quantities.hours.night}h</span></div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase">D-Fest: <span className={`${shift.isAVAShift ? 'text-amber-600' : 'text-indigo-600'} font-mono text-sm ml-1`}>{shift.isAVAShift ? quantities.ava.holidayDay : quantities.hours.holidayDay}h</span></div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase">N-Fest: <span className={`${shift.isAVAShift ? 'text-amber-600' : 'text-indigo-600'} font-mono text-sm ml-1`}>{shift.isAVAShift ? quantities.ava.holidayNight : quantities.hours.holidayNight}h</span></div>
                    {((shift.isAVAShift) ? (quantities.ava.extraDay + quantities.ava.extraNight + quantities.ava.extraHolidayDay + quantities.ava.extraHolidayNight) : (quantities.hours.extraDay + quantities.hours.extraNight + quantities.hours.extraHolidayDay + quantities.hours.extraHolidayNight)) > 0 && (
                      <div className="col-span-2 text-[10px] font-bold text-rose-500 uppercase mt-1 border-t border-rose-100 pt-1 flex justify-between">
                        <span>Turno Adicional:</span>
                        <span className="font-mono text-sm">
                          {shift.isAVAShift 
                            ? (quantities.ava.extraDay + quantities.ava.extraNight + quantities.ava.extraHolidayDay + quantities.ava.extraHolidayNight) 
                            : (quantities.hours.extraDay + quantities.hours.extraNight + quantities.hours.extraHolidayDay + quantities.hours.extraHolidayNight)}h
                        </span>
                      </div>
                    )}
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
                    <h3 className="text-sm font-bold">Ajuste Horas AVA/Virtual</h3>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    {[
                      { label: 'AVA/Virt Diurnas', key: 'day' },
                      { label: 'AVA/Virt Nocturnas', key: 'night' },
                      { label: 'AVA/Virt D-Fest', key: 'holidayDay' },
                      { label: 'AVA/Virt N-Fest', key: 'holidayNight' },
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

                {/* Extra Hours Adjustment */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 text-amber-600">
                      <PlusCircle className="w-4 h-4" />
                      <h3 className="text-sm font-bold">Horas de Turno Adicional</h3>
                    </div>
                    <div className="flex gap-1 bg-amber-100/50 p-0.5 rounded-lg border border-amber-200">
                      {[
                        { id: 'consultation', label: 'Cons' },
                        { id: 'avaVirtual', label: 'AVA/V' },
                      ].map((type) => (
                        <button
                          key={type.id}
                          onClick={() => setShift({ ...shift, extraHoursType: type.id as 'consultation' | 'avaVirtual' })}
                          className={`px-2 py-0.5 rounded-md text-[9px] font-bold uppercase transition-all ${
                            shift.extraHoursType === type.id 
                              ? 'bg-amber-600 text-white shadow-sm' 
                              : 'text-amber-700 hover:bg-amber-200'
                          }`}
                        >
                          {type.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    {[
                      { label: 'Diu Adic', key: 'extraDay' },
                      { label: 'Noc Adic', key: 'extraNight' },
                      { label: 'D-Fest Adic', key: 'extraHolidayDay' },
                      { label: 'N-Fest Adic', key: 'extraHolidayNight' },
                    ].map((item) => (
                      <div key={item.key}>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">{item.label}</label>
                        <input 
                          type="number"
                          step="0.5"
                          value={shift.extraHoursType === 'avaVirtual' ? quantities.ava[item.key as keyof Quantities['ava']] : quantities.hours[item.key as keyof Quantities['hours']]}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            setQuantities({
                              ...quantities,
                              [shift.extraHoursType === 'avaVirtual' ? 'ava' : 'hours']: { 
                                ...quantities[shift.extraHoursType === 'avaVirtual' ? 'ava' : 'hours'], 
                                [item.key]: val 
                              }
                            })
                          }}
                          className="w-full bg-amber-50/50 border border-amber-100 rounded-xl p-2 text-sm focus:ring-2 focus:ring-amber-500 outline-none transition-all font-mono"
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
                        isVirtualShift: false,
                        isExtraShift: false,
                        extraHoursType: 'consultation',
                      });
                      setQuantities({
                        hours: { day: 0, night: 0, holidayDay: 0, holidayNight: 0, extraDay: 0, extraNight: 0, extraHolidayDay: 0, extraHolidayNight: 0 },
                        ava: { day: 0, night: 0, holidayDay: 0, holidayNight: 0, extraDay: 0, extraNight: 0, extraHolidayDay: 0, extraHolidayNight: 0 },
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
                  disabled={periods.find(p => p.id === selectedPeriodId)?.status !== 'active' && !viewingArchive}
                  className={`flex-[2] ${editingId ? 'bg-amber-500 hover:bg-amber-600' : 'bg-indigo-600 hover:bg-indigo-700'} text-white font-bold py-4 rounded-2xl shadow-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  <Calculator className="w-5 h-5" />
                  {editingId ? 'Actualizar Registro' : 'Agregar a la Bitácora'}
                </button>
              </div>
              {periods.find(p => p.id === selectedPeriodId)?.status !== 'active' && !viewingArchive && (
                <p className="text-center text-xs text-amber-600 font-bold bg-amber-50 p-2 rounded-xl border border-amber-100">
                  Este periodo está archivado. Reactívalo para agregar nuevos turnos.
                </p>
              )}
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
                {selectedRecordIds.length > 0 && (
                  <button 
                    onClick={deleteSelectedRecords}
                    className="px-4 py-2 bg-rose-600 text-white text-xs font-bold rounded-xl hover:bg-rose-700 transition-all flex items-center gap-2 shadow-lg shadow-rose-100"
                  >
                    <Trash2 className="w-4 h-4" />
                    Eliminar Seleccionados ({selectedRecordIds.length})
                  </button>
                )}
              </div>

            {!viewingArchive && selectedPeriodId && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                        <Clock className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-slate-800">Límite de Horas Ordinarias</h3>
                        <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">
                          {trisemanas.some(t => {
                            const p = periods.find(per => per.id === selectedPeriodId);
                            return p && ((t.startDate >= p.startDate && t.startDate <= p.endDate) || (t.endDate >= p.startDate && t.endDate <= p.endDate));
                          }) 
                            ? "Usando límites de Trisemana configurados" 
                            : "Define cuándo se activan los recargos por horas extra"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="relative flex items-center gap-2">
                        <input 
                          type="number" 
                          value={periods.find(p => p.id === selectedPeriodId)?.extraThreshold || 0}
                          onChange={(e) => updatePeriodThreshold(Number(e.target.value))}
                          className="w-24 bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-sm font-mono text-center focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                          placeholder="0"
                        />
                        <span className="text-[10px] font-bold text-slate-400 uppercase">Horas</span>
                      </div>
                    </div>
                  </div>
                  
                  {/* Active Trisemanas in this period */}
                  {(() => {
                    const p = periods.find(per => per.id === selectedPeriodId);
                    if (!p) return null;
                    const activeTris = trisemanas.filter(t => 
                      (t.startDate >= p.startDate && t.startDate <= p.endDate) || 
                      (t.endDate >= p.startDate && t.endDate <= p.endDate) ||
                      (t.startDate <= p.startDate && t.endDate >= p.endDate)
                    );
                    if (activeTris.length === 0) return null;
                    return (
                      <div className="mt-4 pt-4 border-t border-slate-100 space-y-2">
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Trisemanas en este periodo</p>
                        <div className="flex flex-wrap gap-2">
                          {activeTris.map(t => (
                            <div key={t.id} className="px-2 py-1 bg-amber-50 border border-amber-100 rounded-lg text-[9px] font-bold text-amber-700">
                              {t.name}: {t.maxHours}h
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                </div>

                <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
                  <div className="flex items-center justify-between mb-4">
                    <div className="space-y-1">
                      <h3 className="text-sm font-bold text-slate-800">Resumen de Horas</h3>
                      <p className="text-[10px] text-slate-400">Discriminación por Trisemana en este periodo</p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    {/* Global Totals */}
                    <div className="flex items-center gap-6 pb-4 border-b border-slate-100">
                      <div>
                        <p className="text-[9px] text-slate-400 uppercase font-bold">Total Ordinarias</p>
                        <p className="text-lg font-mono font-bold text-indigo-600">
                          {results.all.totalRegularHours.toFixed(1)}h
                        </p>
                      </div>
                      <div className="w-px h-8 bg-slate-100" />
                      <div>
                        <p className="text-[9px] text-slate-400 uppercase font-bold">Total Extras</p>
                        <p className="text-lg font-mono font-bold text-amber-600">
                          {results.all.totalExtraHours.toFixed(1)}h
                        </p>
                      </div>
                    </div>

                    {/* Trisemana Breakdown */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {Object.values(results.all.trisemanaBreakdown).map((tri: any, idx) => (
                        <div key={idx} className="bg-slate-50 p-3 rounded-2xl border border-slate-100">
                          <div className="flex items-center gap-2 mb-2">
                            <Clock className="w-3 h-3 text-indigo-500" />
                            <span className="text-[10px] font-bold text-slate-700 uppercase">{tri.name}</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <div>
                              <p className="text-[8px] text-slate-400 uppercase font-bold">Ord</p>
                              <p className="text-sm font-mono font-bold text-indigo-600">{tri.ord.toFixed(1)}h</p>
                            </div>
                            <div className="text-right">
                              <p className="text-[8px] text-slate-400 uppercase font-bold">Exced</p>
                              <p className="text-sm font-mono font-bold text-amber-600">{tri.extra.toFixed(1)}h</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {results.all.totalRegularHours > (periods.find(p => p.id === selectedPeriodId)?.extraThreshold || 160) && !trisemanas.some(t => {
                    const p = periods.find(per => per.id === selectedPeriodId);
                    return p && ((t.startDate >= p.startDate && t.startDate <= p.endDate) || (t.endDate >= p.startDate && t.endDate <= p.endDate));
                  }) && (
                    <div className="bg-rose-50 p-3 rounded-2xl border border-rose-100 flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-rose-500" />
                      <div className="text-[10px] text-rose-700 font-bold leading-tight">
                        Exceso de {(results.all.totalRegularHours - (periods.find(p => p.id === selectedPeriodId)?.extraThreshold || 160)).toFixed(1)}h<br/>
                        <span className="font-normal opacity-70">Deben ser extras</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

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
                      <th className="p-4 w-10">
                        <input 
                          type="checkbox" 
                          checked={selectedRecordIds.length > 0 && selectedRecordIds.length === (viewingArchive ? viewingArchive.records : records).length}
                          onChange={toggleSelectAll}
                          className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                      </th>
                      <th className="p-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Fecha</th>
                      <th className="p-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Horario</th>
                      <th className="p-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Horas Consulta</th>
                      <th className="p-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Horas AVA/Virtual</th>
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
                            className={`hover:bg-slate-50/50 transition-colors ${selectedRecordIds.includes(record.id) ? 'bg-indigo-50/30' : ''}`}
                          >
                            <td className="p-4">
                              <input 
                                type="checkbox" 
                                checked={selectedRecordIds.includes(record.id)}
                                onChange={() => toggleSelectRecord(record.id)}
                                className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                              />
                            </td>
                            <td className="p-4 text-sm font-medium text-slate-700">
                              <div className="flex flex-col gap-1">
                                <div className="flex items-center gap-2">
                                  {record.date}
                                  {record.isExtraShift && (
                                    <span className="px-1.5 py-0.5 bg-amber-100 text-amber-600 text-[8px] font-bold uppercase rounded-md border border-amber-200">
                                      Extra
                                    </span>
                                  )}
                                  {(() => {
                                    const dist = results.all.recordDistributions[record.id];
                                    if (dist?.crossedThreshold) {
                                      return (
                                        <span className="px-1.5 py-0.5 bg-rose-100 text-rose-600 text-[8px] font-bold uppercase rounded-md border border-rose-200 animate-pulse">
                                          Límite 132h Alcanzado
                                        </span>
                                      );
                                    }
                                    if (dist?.alreadyOver) {
                                      return (
                                        <span className="px-1.5 py-0.5 bg-slate-100 text-slate-500 text-[8px] font-bold uppercase rounded-md border border-slate-200">
                                          Sobre 132h
                                        </span>
                                      );
                                    }
                                    return null;
                                  })()}
                                </div>
                                {(() => {
                                  const t = record.trisemanaId 
                                    ? trisemanas.find(tri => tri.id === record.trisemanaId)
                                    : trisemanas.find(tri => record.date >= tri.startDate && record.date <= tri.endDate);
                                  return t ? (
                                    <span className="text-[9px] text-amber-600 font-bold uppercase tracking-tighter flex items-center gap-1">
                                      <Clock className="w-2 h-2" /> {t.name}
                                    </span>
                                  ) : (
                                    <span className="text-[9px] text-rose-500 font-bold uppercase tracking-tighter flex items-center gap-1 animate-pulse">
                                      <AlertCircle className="w-2 h-2" /> Sin Trisemana
                                    </span>
                                  );
                                })()}
                              </div>
                            </td>
                            <td className="p-4 text-xs font-mono text-slate-500">
                              {record.startTime} - {record.endTime === '00:00' ? '00:00 (Siguiente día)' : record.endTime}
                            </td>
                            <td className="p-4 text-xs font-mono font-bold">
                              {(() => {
                                const dist = results.all.recordDistributions[record.id];
                                if (!dist) return null;

                                const isAVAMain = record.isAVAShift || record.isVirtualShift || (Object.values(record.ava || {}).some(v => v > 0) && Object.values(record.hours || {}).every(v => v === 0));
                                const extraType = record.extraHoursType || (isAVAMain ? 'avaVirtual' : 'consultation');

                                const h = {
                                  day: isAVAMain ? 0 : dist.ord.day,
                                  night: isAVAMain ? 0 : dist.ord.night,
                                  holidayDay: isAVAMain ? 0 : dist.ord.holidayDay,
                                  holidayNight: isAVAMain ? 0 : dist.ord.holidayNight,
                                  extraDay: extraType === 'consultation' ? dist.extra.day : 0,
                                  extraNight: extraType === 'consultation' ? dist.extra.night : 0,
                                  extraHolidayDay: extraType === 'consultation' ? dist.extra.holidayDay : 0,
                                  extraHolidayNight: extraType === 'consultation' ? dist.extra.holidayNight : 0
                                };

                                return (
                                  <div className="flex flex-col">
                                    <div className="flex flex-wrap gap-x-2">
                                      {h.day > 0 && <span className="text-amber-600" title="Diurna">{h.day}D</span>}
                                      {h.night > 0 && <span className="text-indigo-600" title="Nocturna">{h.night}N</span>}
                                      {h.holidayDay > 0 && <span className="text-rose-600" title="Festiva Diurna">{h.holidayDay}FD</span>}
                                      {h.holidayNight > 0 && <span className="text-purple-600" title="Festiva Nocturna">{h.holidayNight}FN</span>}
                                    </div>
                                    {(h.extraDay + h.extraNight + h.extraHolidayDay + h.extraHolidayNight) > 0 && (
                                      <div className="text-[9px] text-amber-500 mt-0.5 border-t border-amber-50 pt-0.5 flex flex-wrap gap-x-2">
                                        <span className="font-black">ADICIONAL:</span>
                                        {h.extraDay > 0 && <span>{h.extraDay}ED</span>}
                                        {h.extraNight > 0 && <span>{h.extraNight}EN</span>}
                                        {h.extraHolidayDay > 0 && <span>{h.extraHolidayDay}EFD</span>}
                                        {h.extraHolidayNight > 0 && <span>{h.extraHolidayNight}EFN</span>}
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}
                            </td>
                            <td className="p-4 text-xs font-mono font-bold">
                              {(() => {
                                const dist = results.all.recordDistributions[record.id];
                                if (!dist) return null;

                                const isAVAMain = record.isAVAShift || record.isVirtualShift || (Object.values(record.ava || {}).some(v => v > 0) && Object.values(record.hours || {}).every(v => v === 0));
                                const extraType = record.extraHoursType || (isAVAMain ? 'avaVirtual' : 'consultation');

                                const a = {
                                  day: isAVAMain ? dist.ord.day : 0,
                                  night: isAVAMain ? dist.ord.night : 0,
                                  holidayDay: isAVAMain ? dist.ord.holidayDay : 0,
                                  holidayNight: isAVAMain ? dist.ord.holidayNight : 0,
                                  extraDay: extraType === 'avaVirtual' ? dist.extra.day : 0,
                                  extraNight: extraType === 'avaVirtual' ? dist.extra.night : 0,
                                  extraHolidayDay: extraType === 'avaVirtual' ? dist.extra.holidayDay : 0,
                                  extraHolidayNight: extraType === 'avaVirtual' ? dist.extra.holidayNight : 0
                                };

                                return (
                                  <div className="flex flex-col">
                                    <div className="flex flex-wrap gap-x-2">
                                      {a.day > 0 && <span className="text-amber-600" title="AVA/Virt Diurna">{a.day}D</span>}
                                      {a.night > 0 && <span className="text-indigo-600" title="AVA/Virt Nocturna">{a.night}N</span>}
                                      {a.holidayDay > 0 && <span className="text-rose-600" title="AVA/Virt Festiva Diurna">{a.holidayDay}FD</span>}
                                      {a.holidayNight > 0 && <span className="text-purple-600" title="AVA/Virt Festiva Nocturna">{a.holidayNight}FN</span>}
                                    </div>
                                    {(a.extraDay + a.extraNight + a.extraHolidayDay + a.extraHolidayNight) > 0 && (
                                      <div className="text-[9px] text-amber-500 mt-0.5 border-t border-amber-50 pt-0.5 flex flex-wrap gap-x-2">
                                        <span className="font-black">ADICIONAL:</span>
                                        {a.extraDay > 0 && <span>{a.extraDay}ED</span>}
                                        {a.extraNight > 0 && <span>{a.extraNight}EN</span>}
                                        {a.extraHolidayDay > 0 && <span>{a.extraHolidayDay}EFD</span>}
                                        {a.extraHolidayNight > 0 && <span>{a.extraHolidayNight}EFN</span>}
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}
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
                                const shiftValue = calculateShiftValue(record, results.calculationRates, results.all.recordDistributions[record.id]);
                                const grossShift = shiftValue.base + shiftValue.service + shiftValue.extraSurcharge + shiftValue.avaVirtual;
                                const netShift = grossShift * (1 - results.all.effectiveDeductionRate);
                                
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
                        <td colSpan={3} className="p-4 text-right text-[10px] font-bold text-slate-400 uppercase tracking-widest align-top">
                          Totales del Periodo:
                        </td>
                        <td className="p-4 align-top">
                          <div className="flex flex-col gap-2">
                            <div className="flex flex-col">
                              <span className="text-xs font-mono font-black text-indigo-600">{results.all.totalMonthlyHours.toFixed(1)}h</span>
                              <span className="text-[9px] font-bold text-slate-400 uppercase">Horas Consulta</span>
                            </div>
                            <div className="grid grid-cols-2 gap-x-2 text-[8px] font-bold uppercase tracking-tighter">
                              <span className="text-amber-600">D: {results.all.hoursBreakdown.day.toFixed(1)}h</span>
                              <span className="text-indigo-600">N: {results.all.hoursBreakdown.night.toFixed(1)}h</span>
                              <span className="text-rose-600">DF: {results.all.hoursBreakdown.holidayDay.toFixed(1)}h</span>
                              <span className="text-purple-600">NF: {results.all.hoursBreakdown.holidayNight.toFixed(1)}h</span>
                              <span className="text-amber-700">ED: {results.all.hoursBreakdown.extraDay.toFixed(1)}h</span>
                              <span className="text-indigo-700">EN: {results.all.hoursBreakdown.extraNight.toFixed(1)}h</span>
                              <span className="text-rose-700">EFD: {results.all.hoursBreakdown.extraHolidayDay.toFixed(1)}h</span>
                              <span className="text-purple-700">EFN: {results.all.hoursBreakdown.extraHolidayNight.toFixed(1)}h</span>
                            </div>
                            <div className="pt-1 border-t border-slate-200">
                              <span className="text-[9px] font-bold text-slate-600">{formatCurrency(results.all.totalH)}</span>
                            </div>
                          </div>
                        </td>
                        <td className="p-4 align-top">
                          <div className="flex flex-col gap-2">
                            <div className="flex flex-col">
                              <span className="text-xs font-mono font-black text-violet-600">{results.all.totalMonthlyAVA.toFixed(1)}h</span>
                              <span className="text-[9px] font-bold text-slate-400 uppercase">Horas AVA/Virtual</span>
                            </div>
                            <div className="grid grid-cols-2 gap-x-2 text-[8px] font-bold uppercase tracking-tighter">
                              <span className="text-amber-600">D: {results.all.avaBreakdown.day.toFixed(1)}h</span>
                              <span className="text-indigo-600">N: {results.all.avaBreakdown.night.toFixed(1)}h</span>
                              <span className="text-rose-600">DF: {results.all.avaBreakdown.holidayDay.toFixed(1)}h</span>
                              <span className="text-purple-600">NF: {results.all.avaBreakdown.holidayNight.toFixed(1)}h</span>
                              <span className="text-amber-700">ED: {results.all.avaBreakdown.extraDay.toFixed(1)}h</span>
                              <span className="text-indigo-700">EN: {results.all.avaBreakdown.extraNight.toFixed(1)}h</span>
                              <span className="text-rose-700">EFD: {results.all.avaBreakdown.extraHolidayDay.toFixed(1)}h</span>
                              <span className="text-purple-700">EFN: {results.all.avaBreakdown.extraHolidayNight.toFixed(1)}h</span>
                            </div>
                            <div className="pt-1 border-t border-slate-200">
                              <span className="text-[9px] font-bold text-slate-600">{formatCurrency(results.all.totalAVA)}</span>
                            </div>
                          </div>
                        </td>
                        <td className="p-4 align-top">
                          <div className="flex flex-col gap-2">
                            <div className="flex flex-col">
                              <span className="text-xs font-mono font-black text-emerald-600">{results.all.totalMonthlyPatients} Pac.</span>
                              <span className="text-[9px] font-bold text-slate-400 uppercase">Pacientes</span>
                            </div>
                            <div className="grid grid-cols-2 gap-x-2 text-[8px] font-bold uppercase tracking-tighter">
                              <span className="text-amber-600">D: {results.all.patientsBreakdown.day}</span>
                              <span className="text-indigo-600">N: {results.all.patientsBreakdown.night}</span>
                              <span className="text-rose-600">DF: {results.all.patientsBreakdown.holidayDay}</span>
                              <span className="text-purple-600">NF: {results.all.patientsBreakdown.holidayNight}</span>
                            </div>
                            <div className="pt-1 border-t border-slate-200">
                              <span className="text-[9px] font-bold text-slate-600">{formatCurrency(results.all.totalP)}</span>
                            </div>
                          </div>
                        </td>
                        <td className="p-4 align-top">
                          <div className="flex flex-col gap-1">
                            <span className="text-xs font-mono font-black text-slate-800">{formatCurrency(results.all.gross)}</span>
                            <span className="text-[9px] font-bold text-slate-400 uppercase">Bruto Total</span>
                            
                            <div className="mt-2 p-2 bg-slate-50 rounded-lg border border-slate-100">
                              <p className="text-[8px] font-bold text-slate-600 uppercase mb-1">Resumen Horas</p>
                              <div className="flex flex-col gap-1 text-[8px] font-bold text-slate-500">
                                <div className="flex flex-col border-b border-slate-200 pb-1">
                                  <div className="flex justify-between text-indigo-600">
                                    <span>Consulta:</span> 
                                    <span>{results.all.hoursBreakdown.day + results.all.hoursBreakdown.night + results.all.hoursBreakdown.holidayDay + results.all.hoursBreakdown.holidayNight + results.all.hoursBreakdown.extraDay + results.all.hoursBreakdown.extraNight + results.all.hoursBreakdown.extraHolidayDay + results.all.hoursBreakdown.extraHolidayNight}h</span>
                                  </div>
                                  <div className="grid grid-cols-4 gap-x-1 text-[7px] opacity-70">
                                    <span>D: {results.all.hoursBreakdown.day}</span>
                                    <span>N: {results.all.hoursBreakdown.night}</span>
                                    <span>DF: {results.all.hoursBreakdown.holidayDay}</span>
                                    <span>NF: {results.all.hoursBreakdown.holidayNight}</span>
                                    <span>ED: {results.all.hoursBreakdown.extraDay}</span>
                                    <span>EN: {results.all.hoursBreakdown.extraNight}</span>
                                    <span>EFD: {results.all.hoursBreakdown.extraHolidayDay}</span>
                                    <span>EFN: {results.all.hoursBreakdown.extraHolidayNight}</span>
                                  </div>
                                </div>
                                <div className="flex flex-col">
                                  <div className="flex justify-between text-violet-600">
                                    <span>AVA/Virtual:</span> 
                                    <span>{results.all.avaBreakdown.day + results.all.avaBreakdown.night + results.all.avaBreakdown.holidayDay + results.all.avaBreakdown.holidayNight + results.all.avaBreakdown.extraDay + results.all.avaBreakdown.extraNight + results.all.avaBreakdown.extraHolidayDay + results.all.avaBreakdown.extraHolidayNight}h</span>
                                  </div>
                                  <div className="grid grid-cols-4 gap-x-1 text-[7px] opacity-70">
                                    <span>D: {results.all.avaBreakdown.day}</span>
                                    <span>N: {results.all.avaBreakdown.night}</span>
                                    <span>DF: {results.all.avaBreakdown.holidayDay}</span>
                                    <span>NF: {results.all.avaBreakdown.holidayNight}</span>
                                    <span>ED: {results.all.avaBreakdown.extraDay}</span>
                                    <span>EN: {results.all.avaBreakdown.extraNight}</span>
                                    <span>EFD: {results.all.avaBreakdown.extraHolidayDay}</span>
                                    <span>EFN: {results.all.avaBreakdown.extraHolidayNight}</span>
                                  </div>
                                </div>
                              </div>
                            </div>

                            <div className="mt-2 p-2 bg-slate-50 rounded-lg border border-slate-100">
                              <p className="text-[8px] font-bold text-slate-600 uppercase mb-1">Acumulado Total</p>
                              <div className="flex justify-between items-center">
                                <span className="text-xs font-mono font-black text-slate-700">{results.all.totalAccumulatedHours}h</span>
                                <span className="text-[7px] font-bold text-slate-400 uppercase">Total Periodo</span>
                              </div>
                            </div>

                            <div className="mt-2 p-2 bg-indigo-50 rounded-lg border border-indigo-100">
                              <p className="text-[8px] font-bold text-indigo-600 uppercase mb-1">Resumen Dinero</p>
                              <div className="flex flex-col gap-1 text-[8px] font-bold text-slate-500">
                                <div className="flex flex-col border-b border-indigo-100 pb-1">
                                  <div className="flex justify-between text-indigo-600"><span>Consulta:</span> <span>{formatCurrency(results.all.totalH)}</span></div>
                                  <div className="grid grid-cols-2 gap-x-2 text-[7px] opacity-70">
                                    <span>D: {formatCurrency(results.all.hoursValues.day)}</span>
                                    <span>N: {formatCurrency(results.all.hoursValues.night)}</span>
                                    <span>DF: {formatCurrency(results.all.hoursValues.holidayDay)}</span>
                                    <span>NF: {formatCurrency(results.all.hoursValues.holidayNight)}</span>
                                    <span>ED: {formatCurrency(results.all.hoursValues.extraDay)}</span>
                                    <span>EN: {formatCurrency(results.all.hoursValues.extraNight)}</span>
                                    <span>EFD: {formatCurrency(results.all.hoursValues.extraHolidayDay)}</span>
                                    <span>EFN: {formatCurrency(results.all.hoursValues.extraHolidayNight)}</span>
                                  </div>
                                </div>
                                <div className="flex flex-col border-b border-indigo-100 pb-1">
                                  <div className="flex justify-between text-violet-600"><span>AVA/Virtual:</span> <span>{formatCurrency(results.all.totalAVA)}</span></div>
                                  <div className="grid grid-cols-2 gap-x-2 text-[7px] opacity-70">
                                    <span>D: {formatCurrency(results.all.avaValues.day)}</span>
                                    <span>N: {formatCurrency(results.all.avaValues.night)}</span>
                                    <span>DF: {formatCurrency(results.all.avaValues.holidayDay)}</span>
                                    <span>NF: {formatCurrency(results.all.avaValues.holidayNight)}</span>
                                    <span>ED: {formatCurrency(results.all.avaValues.extraDay)}</span>
                                    <span>EN: {formatCurrency(results.all.avaValues.extraNight)}</span>
                                    <span>EFD: {formatCurrency(results.all.avaValues.extraHolidayDay)}</span>
                                    <span>EFN: {formatCurrency(results.all.avaValues.extraHolidayNight)}</span>
                                  </div>
                                </div>
                                <div className="flex flex-col">
                                  <div className="flex justify-between text-emerald-600"><span>Pacientes:</span> <span>{formatCurrency(results.all.totalP)}</span></div>
                                  <div className="grid grid-cols-2 gap-x-2 text-[7px] opacity-70">
                                    <span>D: {formatCurrency(results.all.patientsValues.day)}</span>
                                    <span>N: {formatCurrency(results.all.patientsValues.night)}</span>
                                    <span>DF: {formatCurrency(results.all.patientsValues.holidayDay)}</span>
                                    <span>NF: {formatCurrency(results.all.patientsValues.holidayNight)}</span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
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

          {/* Step 3.5: Projections and Totals */}
          <section className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-sm">3.5</div>
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-bold text-slate-800">Proyecciones y Totales (Acumulado)</h2>
                <span className="px-3 py-1 bg-indigo-100 text-indigo-700 text-[10px] font-black uppercase tracking-widest rounded-full border border-indigo-200">
                  Incluye Proyecciones
                </span>
              </div>
            </div>
            
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-6">
              <p className="text-sm text-slate-500">Este resumen incluye tanto los registros definitivos como las proyecciones actuales.</p>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="bg-slate-50 p-6 rounded-3xl border border-slate-100 space-y-2">
                  <div className="flex items-center gap-2 text-slate-600">
                    <Clock className="w-4 h-4" />
                    <span className="text-[10px] font-bold uppercase tracking-widest">Horas Totales</span>
                  </div>
                  <p className="text-3xl font-bold text-slate-800">{results.all.totalAccumulatedHours}h</p>
                  <p className="text-[10px] text-slate-400 uppercase font-bold tracking-tighter">
                    Bruto: {formatCurrency(results.all.gross)}
                  </p>
                </div>
                
                <div className="bg-indigo-600 p-6 rounded-3xl text-white space-y-2 shadow-xl shadow-indigo-100">
                  <div className="flex items-center gap-2 opacity-80">
                    <Wallet className="w-4 h-4" />
                    <span className="text-[10px] font-bold uppercase tracking-widest">Neto a Recibir (Caja)</span>
                  </div>
                  <p className="text-3xl font-bold">{formatCurrency(results.all.netCash)}</p>
                  <p className="text-[10px] opacity-70 uppercase font-bold tracking-tighter">Proyectado</p>
                </div>

                <div className="bg-rose-50 p-6 rounded-3xl border border-rose-100 space-y-2">
                  <div className="flex items-center gap-2 text-rose-700">
                    <TrendingDown className="w-4 h-4" />
                    <span className="text-[10px] font-bold uppercase tracking-widest">Deducciones</span>
                  </div>
                  <p className="text-3xl font-bold text-rose-800">{formatCurrency(results.all.totalDeductions)}</p>
                  <p className="text-[10px] text-rose-400 uppercase font-bold tracking-tighter">Legales + Otras</p>
                </div>

                <div className="bg-emerald-50 p-6 rounded-3xl border border-emerald-100 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-emerald-700">
                      <TrendingUp className="w-4 h-4" />
                      <span className="text-[10px] font-bold uppercase tracking-widest">Ganancia Total Real</span>
                    </div>
                    <button 
                      onClick={() => setShowProjectionDetails(!showProjectionDetails)}
                      className="p-1 hover:bg-emerald-100 rounded-lg transition-colors text-emerald-600"
                    >
                      <ChevronDown className={`w-4 h-4 transition-transform ${showProjectionDetails ? 'rotate-180' : ''}`} />
                    </button>
                  </div>
                  <p className="text-3xl font-bold text-emerald-800">{formatCurrency(results.all.net)}</p>
                  <p className="text-[10px] text-emerald-400 uppercase font-bold tracking-tighter italic">
                    Incluye Prestaciones
                  </p>

                  <AnimatePresence>
                    {showProjectionDetails && (
                      <motion.div 
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="pt-4 space-y-2 border-t border-emerald-100 mt-4 overflow-hidden"
                      >
                        <div className="flex justify-between text-[10px]">
                          <span className="text-emerald-600 font-medium">Salario Facturado (Bruto):</span>
                          <span className="font-bold text-emerald-800">{formatCurrency(results.all.gross)}</span>
                        </div>
                        <div className="flex justify-between text-[10px]">
                          <span className="text-emerald-600 font-medium">Prima Proporcional:</span>
                          <span className="font-bold text-emerald-800">{formatCurrency(results.all.primaProporcional)}</span>
                        </div>
                        <div className="flex justify-between text-[10px]">
                          <span className="text-emerald-600 font-medium">Cesantías Proporcionales:</span>
                          <span className="font-bold text-emerald-800">{formatCurrency(results.all.cesantiasProporcional)}</span>
                        </div>
                        <div className="flex justify-between text-[10px]">
                          <span className="text-emerald-600 font-medium">Intereses Cesantías:</span>
                          <span className="font-bold text-emerald-800">{formatCurrency(results.all.interesesCesantias)}</span>
                        </div>
                        <div className="flex justify-between text-[10px]">
                          <span className="text-emerald-600 font-medium">Vacaciones Proporcionales:</span>
                          <span className="font-bold text-emerald-800">{formatCurrency(results.all.vacacionesProporcional)}</span>
                        </div>
                        <div className="flex justify-between text-[10px] pt-1 border-t border-emerald-100">
                          <span className="text-rose-600 font-medium">Deducciones Totales:</span>
                          <span className="font-bold text-rose-700">-{formatCurrency(results.all.totalDeductions)}</span>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>
          </section>

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
                    <div className="flex items-center gap-3">
                      <h3 className="text-2xl font-bold text-slate-800">
                        {periods.find(p => p.id === selectedPeriodId)?.name || 'Extracto de Pago'}
                      </h3>
                      <span className="px-3 py-1 bg-emerald-100 text-emerald-700 text-[10px] font-black uppercase tracking-widest rounded-full border border-emerald-200">
                        Solo Definitivos
                      </span>
                    </div>
                    <p className="text-slate-500 font-medium">Resumen detallado de ingresos y deducciones legales.</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <button 
                      onClick={exportToPDF}
                      className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl hover:bg-indigo-100 transition-all"
                      title="Exportar PDF"
                    >
                      <FileDown className="w-5 h-5" />
                    </button>
                    <button 
                      onClick={() => window.print()}
                      className="p-3 bg-slate-100 text-slate-600 rounded-2xl hover:bg-slate-200 transition-all"
                      title="Imprimir Extracto"
                    >
                      <Printer className="w-5 h-5" />
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
                      <span className="text-[10px] font-bold uppercase tracking-widest">Total Devengado (Mes)</span>
                    </div>
                    <p className="text-3xl font-bold text-emerald-800">{formatCurrency(results.definitive.gross)}</p>
                  </div>
                <div className="bg-rose-50 p-6 rounded-3xl border border-rose-100 space-y-2">
                    <div className="flex items-center gap-2 text-rose-700">
                      <TrendingDown className="w-4 h-4" />
                      <span className="text-[10px] font-bold uppercase tracking-widest">Total Deducciones</span>
                    </div>
                    <p className="text-3xl font-bold text-rose-800">{formatCurrency(results.definitive.totalDeductions)}</p>
                    <div className="flex items-center gap-4 text-[9px] font-bold text-rose-400 uppercase tracking-widest pt-1">
                      <span>Legales: {formatCurrency(results.definitive.legalDeductions)}</span>
                      <span>Otras: {formatCurrency(results.definitive.additionalDeductions)}</span>
                    </div>
                  </div>
                  <div className="bg-indigo-600 p-6 rounded-3xl text-white space-y-2 shadow-xl shadow-indigo-100">
                    <div className="flex items-center gap-2 opacity-80">
                      <Wallet className="w-4 h-4" />
                      <span className="text-[10px] font-bold uppercase tracking-widest">Neto a Recibir (Caja)</span>
                    </div>
                    <p className="text-3xl font-bold">{formatCurrency(results.definitive.netCash)}</p>
                    <p className="text-[9px] opacity-70 italic">Dinero estimado en tu cuenta bancaria.</p>
                  </div>
                </div>

                <div className="p-5 bg-indigo-50 rounded-3xl border border-indigo-100">
                  <p className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest mb-1">Ganancia Total Real (Patrimonial)</p>
                  <p className="text-2xl font-black text-indigo-700">{formatCurrency(results.definitive.totalPatrimonial)}</p>
                  <p className="text-[10px] text-indigo-400 mt-1 italic">
                    Este valor incluye el ahorro de Prima, Vacaciones y Cesantías que estás acumulando este mes.
                  </p>
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
                        <span className="font-bold text-slate-800">{formatCurrency(results.definitive.gross)}</span>
                      </div>
                      <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                        <span className="text-sm font-medium text-slate-600">Prima Proporcional</span>
                        <span className="font-bold text-slate-800">{formatCurrency(results.definitive.primaProporcional)}</span>
                      </div>
                      <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                        <span className="text-sm font-medium text-slate-600">Cesantías Proporcionales</span>
                        <span className="font-bold text-slate-800">{formatCurrency(results.definitive.cesantiasProporcional)}</span>
                      </div>
                      <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                        <span className="text-sm font-medium text-slate-600">Intereses Cesantías</span>
                        <span className="font-bold text-slate-800">{formatCurrency(results.definitive.interesesCesantias)}</span>
                      </div>
                      <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                        <span className="text-sm font-medium text-slate-600">Vacaciones Proporcionales</span>
                        <span className="font-bold text-slate-800">{formatCurrency(results.definitive.vacacionesProporcional)}</span>
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
                          <span className="text-[10px] text-slate-400">IBC: {formatCurrency(results.definitive.ibc)}</span>
                        </div>
                        <span className="font-bold text-rose-700">-{formatCurrency(results.definitive.health)}</span>
                      </div>
                      <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                        <span className="text-sm font-medium text-slate-600">Pensión (4%)</span>
                        <span className="font-bold text-rose-700">-{formatCurrency(results.definitive.pension)}</span>
                      </div>
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                          <span className="text-sm font-medium text-slate-600">Caja de Compensación (4%)</span>
                          <span className="font-bold text-slate-800">{formatCurrency(results.definitive.caja)}</span>
                        </div>
                        <p className="text-[10px] text-slate-400 italic px-1">
                          * El aporte a la Caja de Compensación es asumido por el empleador.
                        </p>
                      </div>
                      {results.definitive.fsp > 0 && (
                        <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                          <span className="text-sm font-medium text-slate-600">Fondo Solidaridad Pensional</span>
                          <span className="font-bold text-rose-700">-{formatCurrency(results.definitive.fsp)}</span>
                        </div>
                      )}
                      {results.definitive.retefuente > 0 && (
                        <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                          <span className="text-sm font-medium text-slate-600">Retención en la Fuente</span>
                          <span className="font-bold text-rose-700">-{formatCurrency(results.definitive.retefuente)}</span>
                        </div>
                      )}
                      {results.definitive.additionalDeductions > 0 && (
                        <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                          <span className="text-sm font-medium text-slate-600">Otras Deducciones</span>
                          <span className="font-bold text-rose-700">-{formatCurrency(results.definitive.additionalDeductions)}</span>
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

          {/* Step 5: Accumulated Totals */}
          <section className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-sm">5</div>
                <h2 className="text-xl font-bold text-slate-800">Totales Acumulados (Todos los Periodos)</h2>
              </div>
              <button 
                onClick={() => setShowAccumulatedDetails(!showAccumulatedDetails)}
                className="px-4 py-2 bg-white border border-indigo-200 text-indigo-600 text-xs font-bold rounded-xl hover:bg-indigo-50 transition-all flex items-center gap-2"
              >
                {showAccumulatedDetails ? 'Ocultar Desglose' : 'Ver Desglose por Periodo'}
                <ChevronDown className={`w-4 h-4 transition-transform ${showAccumulatedDetails ? 'rotate-180' : ''}`} />
              </button>
            </div>

            <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {(() => {
                  const accumulated = periods.reduce((acc, p) => {
                    const isCurrent = p.id === selectedPeriodId;
                    const pGross = isCurrent ? results.all.gross : (p.totalGross || 0);
                    const pTotalGross = isCurrent ? results.all.totalPatrimonial : (p.totalGrossWithBenefits || 0);
                    const pDeductions = isCurrent ? results.all.totalDeductions : (p.totalDeductions || 0);
                    const pNet = isCurrent ? results.all.net : (p.net || 0);
                    const pPrima = isCurrent ? results.all.primaProporcional : (p.primaProporcional || 0);
                    const pCesantias = isCurrent ? results.all.cesantiasProporcional : (p.cesantiasProporcional || 0);
                    const pIntereses = isCurrent ? results.all.interesesCesantias : (p.interesesCesantias || 0);
                    const pVacaciones = isCurrent ? results.all.vacacionesProporcional : (p.vacacionesProporcional || 0);

                    return {
                      gross: acc.gross + pGross,
                      totalGross: acc.totalGross + pTotalGross,
                      deductions: acc.deductions + pDeductions,
                      net: acc.net + pNet,
                      prima: acc.prima + pPrima,
                      cesantias: acc.cesantias + pCesantias,
                      intereses: acc.intereses + pIntereses,
                      vacaciones: acc.vacaciones + pVacaciones
                    };
                  }, { gross: 0, totalGross: 0, deductions: 0, net: 0, prima: 0, cesantias: 0, intereses: 0, vacaciones: 0 });

                  return (
                    <div className="space-y-6">
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                        <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Total Ingreso Salarial</p>
                          <p className="text-xl font-bold text-slate-700">{formatCurrency(accumulated.gross)}</p>
                        </div>
                        <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-100">
                          <div className="flex justify-between items-start">
                            <div>
                              <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest mb-1">Total Ingresos + Prestaciones</p>
                              <p className="text-xl font-bold text-emerald-700">{formatCurrency(accumulated.totalGross)}</p>
                            </div>
                            <button 
                              onClick={() => setShowAccumulatedComponents(!showAccumulatedComponents)}
                              className="p-1 hover:bg-emerald-100 rounded-lg transition-colors text-emerald-600"
                            >
                              <ChevronDown className={`w-4 h-4 transition-transform ${showAccumulatedComponents ? 'rotate-180' : ''}`} />
                            </button>
                          </div>
                        </div>
                        <div className="p-4 bg-rose-50 rounded-2xl border border-rose-100">
                          <p className="text-[10px] font-bold text-rose-600 uppercase tracking-widest mb-1">Total Deducciones</p>
                          <p className="text-xl font-bold text-rose-700">{formatCurrency(accumulated.deductions)}</p>
                        </div>
                        <div className="p-4 bg-indigo-600 rounded-2xl text-white shadow-lg shadow-indigo-100">
                          <p className="text-[10px] font-bold opacity-80 uppercase tracking-widest mb-1">Total Neto</p>
                          <p className="text-xl font-bold">{formatCurrency(accumulated.net)}</p>
                        </div>
                      </div>

                      <AnimatePresence>
                        {showAccumulatedComponents && (
                          <motion.div 
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="bg-slate-50 p-6 rounded-2xl border border-slate-100 overflow-hidden"
                          >
                            <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4">Desglose de Componentes Acumulados</h4>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                              <div className="space-y-3">
                                <div className="flex justify-between items-center border-b border-slate-200 pb-2">
                                  <span className="text-xs font-medium text-slate-600">Total Salario Bruto:</span>
                                  <span className="text-xs font-bold text-slate-800">{formatCurrency(accumulated.gross)}</span>
                                </div>
                                <div className="flex justify-between items-center border-b border-slate-200 pb-2">
                                  <span className="text-xs font-medium text-slate-600">Total Prima:</span>
                                  <span className="text-xs font-bold text-emerald-600">{formatCurrency(accumulated.prima)}</span>
                                </div>
                              </div>
                              <div className="space-y-3">
                                <div className="flex justify-between items-center border-b border-slate-200 pb-2">
                                  <span className="text-xs font-medium text-slate-600">Total Cesantías:</span>
                                  <span className="text-xs font-bold text-emerald-600">{formatCurrency(accumulated.cesantias)}</span>
                                </div>
                                <div className="flex justify-between items-center border-b border-slate-200 pb-2">
                                  <span className="text-xs font-medium text-slate-600">Total Intereses Cesantías:</span>
                                  <span className="text-xs font-bold text-emerald-600">{formatCurrency(accumulated.intereses)}</span>
                                </div>
                              </div>
                              <div className="space-y-3">
                                <div className="flex justify-between items-center border-b border-slate-200 pb-2">
                                  <span className="text-xs font-medium text-slate-600">Total Vacaciones:</span>
                                  <span className="text-xs font-bold text-emerald-600">{formatCurrency(accumulated.vacaciones)}</span>
                                </div>
                                <div className="flex justify-between items-center border-b border-slate-200 pb-2">
                                  <span className="text-xs font-medium text-rose-500">Total Deducciones:</span>
                                  <span className="text-xs font-bold text-rose-600">-{formatCurrency(accumulated.deductions)}</span>
                                </div>
                              </div>
                            </div>

                            <div className="mt-8 overflow-x-auto rounded-xl border border-slate-200 bg-white">
                              <table className="w-full text-left border-collapse">
                                <thead>
                                  <tr className="bg-slate-50 border-b border-slate-200">
                                    <th className="p-3 text-[9px] font-bold text-slate-500 uppercase tracking-wider">Mes / Periodo</th>
                                    <th className="p-3 text-[9px] font-bold text-slate-500 uppercase tracking-wider text-right">Salario Bruto</th>
                                    <th className="p-3 text-[9px] font-bold text-slate-500 uppercase tracking-wider text-right">Prima</th>
                                    <th className="p-3 text-[9px] font-bold text-slate-500 uppercase tracking-wider text-right">Cesantías</th>
                                    <th className="p-3 text-[9px] font-bold text-slate-500 uppercase tracking-wider text-right">Intereses</th>
                                    <th className="p-3 text-[9px] font-bold text-slate-500 uppercase tracking-wider text-right">Vacaciones</th>
                                    <th className="p-3 text-[9px] font-bold text-slate-500 uppercase tracking-wider text-right">Total Ingresos</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                  {periods.map(p => {
                                    const isCurrent = p.id === selectedPeriodId;
                                    const pGross = isCurrent ? results.all.gross : (p.totalGross || 0);
                                    const pPrima = isCurrent ? results.all.primaProporcional : (p.primaProporcional || 0);
                                    const pCesantias = isCurrent ? results.all.cesantiasProporcional : (p.cesantiasProporcional || 0);
                                    const pIntereses = isCurrent ? results.all.interesesCesantias : (p.interesesCesantias || 0);
                                    const pVacaciones = isCurrent ? results.all.vacacionesProporcional : (p.vacacionesProporcional || 0);
                                    const pTotal = isCurrent ? results.all.totalPatrimonial : (p.totalGrossWithBenefits || 0);

                                    return (
                                      <tr key={p.id} className="hover:bg-slate-50/50 transition-colors">
                                        <td className="p-3 text-[10px] font-bold text-slate-700">
                                          {p.name}
                                          {isCurrent && <span className="ml-2 px-1.5 py-0.5 bg-indigo-100 text-indigo-600 text-[8px] rounded-full uppercase">Actual</span>}
                                        </td>
                                        <td className="p-3 text-[10px] font-mono text-right text-slate-600">{formatCurrency(pGross)}</td>
                                        <td className="p-3 text-[10px] font-mono text-right text-emerald-600">{formatCurrency(pPrima)}</td>
                                        <td className="p-3 text-[10px] font-mono text-right text-emerald-600">{formatCurrency(pCesantias)}</td>
                                        <td className="p-3 text-[10px] font-mono text-right text-emerald-600">{formatCurrency(pIntereses)}</td>
                                        <td className="p-3 text-[10px] font-mono text-right text-emerald-600">{formatCurrency(pVacaciones)}</td>
                                        <td className="p-3 text-[10px] font-mono text-right font-bold text-emerald-700">{formatCurrency(pTotal)}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })()}
              </div>

              {showAccumulatedDetails && (
                <motion.div 
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="overflow-x-auto rounded-2xl border border-slate-100">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-100">
                          <th className="p-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Periodo</th>
                          <th className="p-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right">Ingreso Salarial</th>
                          <th className="p-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right">Ingresos + Prestaciones</th>
                          <th className="p-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right">Deducciones</th>
                          <th className="p-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right">Neto</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {periods.map(p => (
                          <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                            <td className="p-4">
                              <p className="text-xs font-bold text-slate-700">{p.name}</p>
                              <p className="text-[9px] text-slate-400">{p.startDate} - {p.endDate}</p>
                            </td>
                            <td className="p-4 text-xs font-mono text-right text-slate-600">{formatCurrency(p.totalGross || 0)}</td>
                            <td className="p-4 text-xs font-mono text-right text-emerald-600 font-bold">{formatCurrency(p.totalGrossWithBenefits || 0)}</td>
                            <td className="p-4 text-xs font-mono text-right text-rose-500">{formatCurrency(p.totalDeductions || 0)}</td>
                            <td className="p-4 text-xs font-mono text-right text-indigo-600 font-bold">{formatCurrency(p.net || 0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </motion.div>
              )}
            </div>
          </section>

          {/* Step 6: Period History */}
          <section className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-slate-800 text-white flex items-center justify-center font-bold text-sm">6</div>
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
                        <div className="flex items-center gap-2">
                          <div className={`p-2 rounded-xl ${p.status === 'active' ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-200 text-slate-500'}`}>
                            <Calendar className="w-4 h-4" />
                          </div>
                          <div className="flex flex-col">
                            <span className={`px-2 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-wider w-fit ${
                              p.status === 'active' ? 'bg-emerald-500 text-white' : 'bg-slate-300 text-slate-600'
                            }`}>
                              {p.status === 'active' ? 'Activo' : 'Archivado'}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              openEditPeriod(p);
                            }}
                            className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-white rounded-lg transition-all"
                            title="Editar Periodo"
                          >
                            <Edit className="w-3.5 h-3.5" />
                          </button>
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              deletePeriod(p.id);
                            }}
                            className="p-2 text-slate-400 hover:text-rose-500 hover:bg-white rounded-lg transition-all"
                            title="Eliminar Periodo"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      <h4 className="font-bold text-slate-800 mb-1 group-hover:text-indigo-600 transition-colors">{p.name}</h4>
                      <p className="text-[10px] text-slate-500 font-medium">
                        {p.startDate} al {p.endDate}
                      </p>
                      {p.totalGross !== undefined && (
                        <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between">
                          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Ingreso Salarial</span>
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
      {/* Period Selection Modal (After Save and Close) */}
      <AnimatePresence>
        {showPeriodSelectionModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white w-full max-w-md rounded-[32px] shadow-2xl overflow-hidden"
            >
              <div className="p-8 space-y-6">
                <div className="text-center space-y-2">
                  <div className="w-16 h-16 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center mx-auto mb-4">
                    <CheckCircle2 className="w-8 h-8" />
                  </div>
                  <h2 className="text-2xl font-bold text-slate-900">Cambios Guardados</h2>
                  <p className="text-slate-500 text-sm">El periodo ha sido actualizado. ¿Qué deseas hacer ahora?</p>
                </div>

                <div className="space-y-3">
                  <button 
                    onClick={() => {
                      setShowPeriodSelectionModal(false);
                      setShowPeriodModal(true);
                    }}
                    className="w-full p-4 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-all flex items-center justify-between group"
                  >
                    <div className="flex items-center gap-3">
                      <PlusCircle className="w-5 h-5" />
                      <span>Crear un nuevo periodo</span>
                    </div>
                    <ChevronDown className="w-4 h-4 -rotate-90 opacity-0 group-hover:opacity-100 transition-all" />
                  </button>

                  <div className="relative py-2">
                    <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-100"></div></div>
                    <div className="relative flex justify-center text-[10px] uppercase font-bold text-slate-400 bg-white px-2">O selecciona uno existente</div>
                  </div>

                  <div className="max-h-48 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                    {periods.map(p => (
                      <button 
                        key={p.id}
                        onClick={() => {
                          setSelectedPeriodId(p.id);
                          setShowPeriodSelectionModal(false);
                          setViewingArchive(null);
                        }}
                        className={`w-full p-3 rounded-xl border text-left transition-all flex items-center justify-between hover:border-indigo-300 hover:bg-indigo-50 ${p.status === 'active' ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-100 bg-slate-50/50'}`}
                      >
                        <div>
                          <p className="text-xs font-bold text-slate-700">{p.name}</p>
                          <p className="text-[10px] text-slate-500">{p.startDate} - {p.endDate}</p>
                        </div>
                        {p.status === 'active' && <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />}
                      </button>
                    ))}
                  </div>
                </div>

                <button 
                  onClick={() => setShowPeriodSelectionModal(false)}
                  className="w-full py-3 text-slate-500 text-xs font-bold hover:text-slate-700 transition-colors"
                >
                  Cerrar y quedarme aquí
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showTrisemanaModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl shadow-2xl max-w-md w-full overflow-hidden"
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-amber-600 text-white">
                <div className="flex items-center gap-3">
                  <Clock className="w-5 h-5" />
                  <h3 className="font-bold">Nueva Trisemana</h3>
                </div>
                <button 
                  onClick={() => setShowTrisemanaModal(false)} 
                  className="p-1 hover:bg-white/20 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="p-6 space-y-6">
                <p className="text-sm text-slate-500 leading-relaxed">
                  Define un intervalo de 3 semanas y su tope de horas. Las horas que excedan este tope se calcularán con recargos de horas extra.
                </p>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 tracking-wider">Nombre (Opcional)</label>
                    <input 
                      type="text"
                      placeholder="Ej: Trisemana Abril A"
                      value={newTrisemanaData.name}
                      onChange={(e) => setNewTrisemanaData({ ...newTrisemanaData, name: e.target.value })}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-sm focus:ring-2 focus:ring-amber-500 outline-none transition-all"
                    />
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 tracking-wider">Fecha Inicio</label>
                      <input 
                        type="date"
                        value={newTrisemanaData.startDate}
                        onChange={(e) => setNewTrisemanaData({ ...newTrisemanaData, startDate: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-sm focus:ring-2 focus:ring-amber-500 outline-none transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 tracking-wider">Fecha Fin</label>
                      <input 
                        type="date"
                        value={newTrisemanaData.endDate}
                        onChange={(e) => setNewTrisemanaData({ ...newTrisemanaData, endDate: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-sm focus:ring-2 focus:ring-amber-500 outline-none transition-all"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 tracking-wider">Tope de Horas (Trisemana)</label>
                    <div className="relative">
                      <input 
                        type="number"
                        value={newTrisemanaData.maxHours}
                        onChange={(e) => setNewTrisemanaData({ ...newTrisemanaData, maxHours: Number(e.target.value) })}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-sm focus:ring-2 focus:ring-amber-500 outline-none transition-all font-mono"
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400 uppercase">Horas</span>
                    </div>
                  </div>
                </div>
                
                <button 
                  onClick={createTrisemana}
                  className="w-full py-4 bg-amber-600 text-white font-bold rounded-2xl hover:bg-amber-700 transition-all shadow-lg shadow-amber-200 flex items-center justify-center gap-2"
                >
                  <CheckCircle2 className="w-5 h-5" />
                  Crear Trisemana
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

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
                  <h3 className="font-bold">
                    {editingPeriod ? 'Editar Periodo' : 'Nuevo Periodo de Facturación'}
                  </h3>
                </div>
                <button 
                  onClick={() => {
                    setShowPeriodModal(false);
                    setEditingPeriod(null);
                  }} 
                  className="p-1 hover:bg-white/20 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="p-6 space-y-6">
                <p className="text-sm text-slate-500 leading-relaxed">
                  {editingPeriod 
                    ? 'Actualiza los datos del periodo seleccionado.' 
                    : 'Al iniciar un nuevo periodo, el actual se archivará y podrás consultarlo más tarde.'}
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

                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 tracking-wider">Límite de Horas para Extras (Threshold)</label>
                    <div className="relative">
                      <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input 
                        type="number"
                        placeholder="Ej: 160"
                        value={newPeriodData.extraThreshold}
                        onChange={(e) => setNewPeriodData({ ...newPeriodData, extraThreshold: Number(e.target.value) })}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 pl-10 pr-4 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-mono"
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 text-xs">Horas</span>
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="p-6 bg-slate-50 flex gap-3">
                <button 
                  onClick={() => {
                    setShowPeriodModal(false);
                    setEditingPeriod(null);
                  }}
                  className="flex-1 py-3 border border-slate-200 text-slate-600 font-bold rounded-xl hover:bg-white transition-all"
                >
                  Cancelar
                </button>
                <button 
                  onClick={savePeriod}
                  className="flex-1 py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200"
                >
                  {editingPeriod ? 'Guardar Cambios' : 'Iniciar Periodo'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showHelp && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white w-full max-w-sm rounded-[32px] shadow-2xl overflow-hidden"
            >
              <div className="p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-indigo-600">
                    <Info className="w-5 h-5" />
                    <h3 className="font-bold text-slate-900">{showHelp.title}</h3>
                  </div>
                  <button 
                    onClick={() => setShowHelp(null)}
                    className="p-2 hover:bg-slate-100 rounded-xl transition-colors text-slate-400"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-sm text-slate-600 leading-relaxed">
                  {showHelp.content}
                </p>
                <button 
                  onClick={() => setShowHelp(null)}
                  className="w-full py-3 bg-slate-900 text-white rounded-2xl font-bold hover:bg-slate-800 transition-all"
                >
                  Entendido
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {confirmDialog && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl shadow-2xl max-w-sm w-full overflow-hidden"
            >
              <div className="p-6 space-y-4">
                <div className="flex items-center gap-3 text-amber-500">
                  <AlertTriangle className="w-6 h-6" />
                  <h3 className="font-bold text-slate-900">Confirmar Acción</h3>
                </div>
                <p className="text-sm text-slate-600 leading-relaxed">
                  {confirmDialog.message}
                </p>
                <div className="flex gap-3 pt-2">
                  <button 
                    onClick={() => setConfirmDialog(null)}
                    className="flex-1 py-3 border border-slate-200 text-slate-600 font-bold rounded-xl hover:bg-slate-50 transition-all"
                  >
                    Cancelar
                  </button>
                  <button 
                    onClick={() => {
                      confirmDialog.onConfirm();
                      setConfirmDialog(null);
                    }}
                    className="flex-1 py-3 bg-rose-600 text-white font-bold rounded-xl hover:bg-rose-700 transition-all shadow-lg shadow-rose-200"
                  >
                    Confirmar
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
