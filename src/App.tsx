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
  Edit,
  Trash2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- Types ---

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
  date: string;
  startTime: string;
  endTime: string;
  hours: Quantities['hours'];
  ava: Quantities['ava'];
  patients: Quantities['patients'];
  applyPatients: boolean;
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
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [showDetails, setShowDetails] = useState(false);

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

      setQuantities(prev => ({
        ...prev,
        hours: shift.isAVAShift ? { day: 0, night: 0, holidayDay: 0, holidayNight: 0 } : {
          day: Math.round((minsD / 60) * 100) / 100,
          night: Math.round((minsN / 60) * 100) / 100,
          holidayDay: Math.round((minsDF / 60) * 100) / 100,
          holidayNight: Math.round((minsNF / 60) * 100) / 100,
        },
        ava: shift.isAVAShift ? {
          day: Math.round((minsD / 60) * 100) / 100,
          night: Math.round((minsN / 60) * 100) / 100,
          holidayDay: Math.round((minsDF / 60) * 100) / 100,
          holidayNight: Math.round((minsNF / 60) * 100) / 100,
        } : prev.ava
      }));
    };

    calculateDistribution();
  }, [shift.startTime, shift.endTime, shift.isHolidayStart, shift.isHolidayEnd, shift.isAVAShift]);

  // --- Actions ---
  const addRecord = () => {
    const newRecord: ShiftRecord = {
      id: crypto.randomUUID(),
      date: shift.date,
      startTime: shift.startTime,
      endTime: shift.endTime,
      hours: { ...quantities.hours },
      ava: { ...quantities.ava },
      patients: { ...quantities.patients },
      applyPatients: quantities.applyPatients,
    };
    
    const updatedRecords = [...records, newRecord].sort((a, b) => {
      const dateA = new Date(`${a.date}T${a.startTime}`).getTime();
      const dateB = new Date(`${b.date}T${b.startTime}`).getTime();
      return dateA - dateB;
    });

    setRecords(updatedRecords);
    // Reset patient and AVA counts for next entry
    setQuantities(prev => ({
      ...prev,
      ava: { day: 0, night: 0, holidayDay: 0, holidayNight: 0 },
      patients: { day: 0, night: 0, holidayDay: 0, holidayNight: 0 }
    }));
  };

  const removeRecord = (id: string) => {
    setRecords(records.filter(r => r.id !== id));
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

  // --- Calculations ---
  const results = useMemo(() => {
    let totalH = 0;
    let totalP = 0;
    let totalAVA = 0;

    records.forEach(record => {
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
        totalP += 
          (record.patients.day * rates.patient.day) +
          (record.patients.night * rates.patient.night) +
          (record.patients.holidayDay * rates.patient.holidayDay) +
          (record.patients.holidayNight * rates.patient.holidayNight);
      }
    });

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

    const totalDeductions = health + pension + fsp;
    const net = gross - totalDeductions;

    return {
      totalH,
      totalP,
      totalAVA,
      gross,
      health,
      pension,
      fsp,
      totalDeductions,
      net
    };
  }, [records, rates]);

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
        <button 
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className="lg:hidden p-2 hover:bg-slate-100 rounded-lg transition-colors"
        >
          <Settings className="w-5 h-5 text-slate-600" />
        </button>
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
              </div>
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
                        onChange={(e) => setQuantities({ ...quantities, applyPatients: e.target.checked })}
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

          {/* Step 4: Results */}
          <section className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-slate-800 text-white flex items-center justify-center font-bold text-sm">4</div>
              <h2 className="text-xl font-bold text-slate-800">Liquidación Final</h2>
            </div>

            {records.length > 0 ? (
              <>
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
                    <div className="text-2xl font-black text-rose-600 font-mono">-{formatCurrency(results.totalDeducciones)}</div>
                    <div className="mt-2 text-[10px] text-slate-400 font-medium">Salud, Pensión y FSP</div>
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
                                  <tr className="font-bold text-rose-600">
                                    <td className="py-3">Total Deducciones</td>
                                    <td className="py-3 text-right font-mono">{formatCurrency(results.totalDeducciones)}</td>
                                  </tr>
                                </tbody>
                              </table>
                              <p className="text-[10px] text-slate-400 italic mt-4">* ARL: Asumida por el empleador. El FSP aplica si el total mensual supera 4 salarios mínimos.</p>
                            </div>
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
