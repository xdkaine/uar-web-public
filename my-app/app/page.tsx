import { HomeAccessCards } from '@/components/home/HomeAccessCards';
import { WorkflowLoader } from '@/components/home/WorkflowLoader';

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-gray-100 text-gray-900">
      <div className="container mx-auto px-4 py-6 sm:px-6 sm:py-10 md:px-8 md:py-16">
        <div className="mb-8 text-center sm:mb-12">
          <header>
            <h2 className="mb-3 px-2 text-2xl font-bold leading-tight text-gray-900 sm:mb-4 sm:text-3xl md:text-4xl lg:text-5xl">
              <span className="text-yellow-800">User Access Request Portal</span>
            </h2>
            <p className="mx-auto max-w-3xl px-4 text-sm leading-relaxed text-gray-700 sm:text-base md:text-lg">
              Request access for the{' '}
              <a href="https://www.cpp.edu/cba/digital-innovation/index.shtml" className="font-semibold text-blue-600 hover:underline">
                Mitchell C. Hill Student Data Center
              </a>
              {' '}resources which are monitored and managed by the{' '}
              <a href="https://www.calpolysoc.org/team" className="font-semibold text-blue-600 hover:underline">
                Student Directors of the SOC & SDC
              </a>.
            </p>
          </header>
        </div>

        <HomeAccessCards />
        <WorkflowLoader />
      </div>
    </div>
  );
}
