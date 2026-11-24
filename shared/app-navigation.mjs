export const DEFAULT_HOME_PATH = '/dashboard';
export const appPages = [
  { id: 'overview', path: DEFAULT_HOME_PATH, label: 'Tổng quan', icon: 'grid', group: 'main', description: 'Một góc nhỏ để hiểu dòng tiền và chăm chút ngày mai.' },
  { id: 'transactions', path: '/transactions', label: 'Giao dịch', icon: 'transactions', group: 'main', description: 'Theo dõi các khoản thu, chi trong nhịp sống mỗi ngày.' },
  { id: 'budgets', path: '/budgets', label: 'Ngân sách', icon: 'budget', group: 'main', description: 'Dành một khoảng vừa đủ cho những điều cần thiết.' },
  { id: 'goals', path: '/goals', label: 'Mục tiêu', icon: 'target', group: 'main', description: 'Từng bước nhỏ hôm nay, gần hơn với điều bạn mong muốn.' },
  { id: 'wallets', path: '/wallets', label: 'Ví của tôi', icon: 'wallet', group: 'main', description: 'Một nơi gọn gàng cho các ví và nguồn tiền của bạn.' },
  { id: 'reports', path: '/reports', label: 'Báo cáo', icon: 'chart', group: 'main', description: 'Nhìn lại thói quen thu chi, chọn cách cân bằng phù hợp.' },
  { id: 'settings', path: '/settings', label: 'Cài đặt', icon: 'settings', group: 'secondary', description: 'Không gian quản lý các tùy chọn của bạn trên LÁ.' },
  { id: 'help', path: '/help', label: 'Trợ giúp', icon: 'help', group: 'secondary', description: 'Một chút hướng dẫn để bạn bắt đầu thật nhẹ nhàng.' },
  { id: 'account', path: '/account', label: 'Tài khoản', icon: 'user', group: 'secondary', description: 'Thông tin cá nhân gắn với tài khoản LÁ của bạn.' },
];
export const createAppNavigation = (homePath = DEFAULT_HOME_PATH) => appPages.map(page => ({ ...page, path: page.id === 'overview' ? homePath : page.path }));
