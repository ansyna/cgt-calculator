import { Receipt } from 'lucide-react';
import { Navigate } from 'react-router';
import type { AppDefinition } from '../../platform/apps';
import { INVESTOR_ROLES } from '../../platform/auth';
import './cgt.css';
import { CgtMenu } from './components/CgtMenu';
import Form11 from './pages/Form11';
import FormCg1 from './pages/FormCg1';
import Import from './pages/Import';
import TaxYear from './pages/TaxYear';
import Transactions from './pages/Transactions';

export const cgt: AppDefinition = {
  id: 'cgt',
  name: 'CGT calculator',
  shortName: 'CGT',
  description: 'Capital gains tax on the shares you sell, worked out from your purchases and sales for Form CG1 or Form 11.',
  icon: Receipt,
  path: '/cgt',
  // the only app: its start page is the site's
  ownsPath: (pathname) => pathname === '/' || pathname === '/cgt' || pathname.startsWith('/cgt/'),
  routes: [
    { path: '/', element: <Navigate to="/cgt" replace />, access: INVESTOR_ROLES },
    { path: '/cgt', element: <TaxYear />, access: INVESTOR_ROLES },
    { path: '/cgt/cg1', element: <FormCg1 />, access: INVESTOR_ROLES },
    { path: '/cgt/form11', element: <Form11 />, access: INVESTOR_ROLES },
    { path: '/cgt/transactions', element: <Transactions />, access: INVESTOR_ROLES },
    { path: '/cgt/import', element: <Import />, access: INVESTOR_ROLES },
  ],
  Menu: CgtMenu,
};
