import React from 'react';

const getGradeColor = (grade: number) => {
  if (grade >= 9) return 'text-green-500';
  if (grade >= 7) return 'text-yellow-500';
  if (grade >= 5) return 'text-orange-500';
  return 'text-red-500';
};

export const GradeDisplay: React.FC<{ grade: number, gradeName: string }> = ({ grade, gradeName }) => (
    <div className="text-center">
      <div className={`font-bold text-5xl md:text-6xl ${getGradeColor(grade)}`}>
        {grade.toFixed(1)}
      </div>
      <div className="font-semibold text-lg text-slate-700">{gradeName}</div>
    </div>
);

export const EvaluationRow: React.FC<{ category: string; grade?: number; notes?: string }> = ({ category, grade, notes }) => (
    <tr className="border-b border-slate-200 last:border-b-0">
        <td className="py-3 px-4 font-semibold text-slate-800">{category}</td>
        <td className={`py-3 px-4 text-center font-bold text-xl ${getGradeColor(grade ?? 0)}`}>{grade ?? '-'}</td>
        <td className="py-3 px-4 text-sm text-slate-600 leading-relaxed">{notes ?? 'N/A'}</td>
    </tr>
);