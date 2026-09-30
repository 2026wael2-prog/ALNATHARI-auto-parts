import React from 'react';
import { ReconciliationPageLayout } from './DailyReconciliationPage.sections';
import { useReconciliationPageController } from './useReconciliationPageController';

/**
 * المطابقة اليومية وإقفال الصندوق.
 * الصفحة طبقة عرض رقيقة: `useReconciliationPageController` يجمع الحالة والاستعلامات
 * والمُعالِجات، و`ReconciliationPageLayout` يعرض الأقسام (شريط أعلى، نطاق المنشأة،
 * الجرد، لوحة الإقفال، والنوافذ) دون أي منطق أعمال داخل الصفحة.
 */
const DailyReconciliationPage: React.FC = () => {
  const page = useReconciliationPageController();

  return <ReconciliationPageLayout page={page} />;
};

export default DailyReconciliationPage;
