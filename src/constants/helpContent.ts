export const HELP_CONTENT: { [key: string]: { title: string, content: string } } = {
  uvt: {
    title: "Valor UVT 2026",
    content: "La Unidad de Valor Tributario (UVT) es la medida que permite estandarizar los valores de los impuestos en Colombia. Para el año 2026, se utiliza para calcular los límites de deducciones y los rangos de la Retención en la Fuente."
  },
  cutoff: {
    title: "Día de Corte",
    content: "Es el día del mes en el que se cierra la contabilidad de tus turnos. Los registros posteriores a esta fecha se contabilizarán en el siguiente periodo de pago."
  },
  dependents: {
    title: "Dependientes",
    content: "De acuerdo con el Estatuto Tributario, puedes deducir el 10% de tus ingresos brutos (hasta un máximo de 32 UVT mensuales) si tienes personas a cargo (hijos menores, cónyuge o padres con dependencia económica)."
  },
  nightShift: {
    title: "Inicio Hora Nocturna",
    content: "En Colombia, el recargo nocturno legalmente inicia a las 9:00 PM (21:00). Sin embargo, algunos contratos o acuerdos pueden definir un inicio diferente. Este parámetro ajusta el cálculo de tus horas nocturnas."
  },
  prepagada: {
    title: "Medicina Prepagada",
    content: "Los pagos realizados a medicina prepagada o seguros de salud son deducibles de la base de Retención en la Fuente, con un límite máximo de 16 UVT mensuales."
  },
  interesesVivienda: {
    title: "Intereses de Vivienda",
    content: "Los intereses pagados por créditos hipotecarios o leasing habitacional para adquisición de vivienda son deducibles hasta un máximo de 100 UVT mensuales."
  },
  pensionVoluntaria: {
    title: "Pensión Voluntaria / AFC",
    content: "Los aportes a fondos de pensiones voluntarias o cuentas AFC no forman parte de la base gravable, siempre que no superen el 30% del ingreso laboral y no excedan las 3.800 UVT anuales."
  },
  avgBilling: {
    title: "Promedio Facturado y Cortes",
    content: "• Primas: Se calculan sobre el promedio del semestre actual (Ene-Jun o Jul-Dic). El promedio se reinicia automáticamente al cambiar de semestre.\n• Vacaciones: Se calculan sobre el promedio de los últimos 12 meses (o desde el último reinicio). Si ya recibiste tus vacaciones, usa el botón 'Reiniciar Ciclo' para comenzar un nuevo cálculo desde cero."
  },
  ibcMinimo: {
    title: "Aportar sobre el Mínimo",
    content: "Si activas esta opción, tus deducciones de Salud y Pensión se calcularán sobre el Salario Mínimo (SMMLV), independientemente de si ganas más. Esto aumenta tu neto mensual pero reduce tus aportes a seguridad social."
  }
};
