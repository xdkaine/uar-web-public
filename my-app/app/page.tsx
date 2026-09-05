import { HomeAccessCards } from '@/components/home/HomeAccessCards';
import { WorkflowLoader } from '@/components/home/WorkflowLoader';
import PortalPageHeading from '@/components/appearance/PortalPageHeading';
import styles from './home.module.css';

export default function Home() {
  return (
    <div className={`${styles.home} min-h-screen bg-gradient-to-b from-white to-gray-100 text-gray-900 dark:bg-background dark:bg-none dark:text-foreground`}>
      <div className="container mx-auto px-4 py-6 sm:px-6 sm:py-10 md:px-8 md:py-16">
        <div className="mb-8 text-center sm:mb-12">
          <PortalPageHeading page="home" centered />
        </div>

        <HomeAccessCards />
        <WorkflowLoader />
      </div>
    </div>
  );
}
