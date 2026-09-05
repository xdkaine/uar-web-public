'use client';

import Link from 'next/link';
import Image from 'next/image';
import * as m from 'framer-motion/m';
import { LazyMotionBoundary } from '@/components/animations/LazyMotionBoundary';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2, Download, Monitor, Terminal, Shield,
  Info, ArrowLeft, ExternalLink, AlertCircle, Laptop
} from "lucide-react";

function InstructionsPageContent() {
  return (
    <div className="min-h-screen bg-muted/50 py-8 sm:py-12 px-4">
      <div className="max-w-4xl mx-auto space-y-6">
        <m.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <Button variant="link" asChild className="pl-0 text-muted-foreground hover:text-foreground">
            <Link href="/" className="flex items-center gap-2">
              <ArrowLeft className="w-4 h-4" />
              Back to Home
            </Link>
          </Button>
        </m.div>

        <m.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        >
          <Card className="border-2 shadow-lg">
            <CardHeader className="text-center pb-2">
              <div className="mx-auto w-16 h-16 bg-green-100 dark:bg-green-950/40 rounded-full flex items-center justify-center mb-4">
                <Shield className="w-8 h-8 text-green-600 dark:text-green-400" />
              </div>
              <CardTitle className="text-3xl font-bold">VPN Setup Instructions</CardTitle>
              <CardDescription className="text-lg">
                Follow these steps to configure and connect to the VPN
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6 pt-6">

              <Alert className="bg-green-50 dark:bg-green-950/40 text-green-800 dark:text-green-200 border-green-200 dark:border-green-900">
                <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
                <AlertTitle className="text-green-800 dark:text-green-200 font-semibold mb-2">Your account is ready!</AlertTitle>
                <AlertDescription className="text-green-700 dark:text-green-200">
                  You&apos;ve successfully authenticated! The credentials used to login will allow you access throughout Proxmox (SDC) and Kamino. Below you&apos;ll find instructions on how to access our infrastructure via GlobalProtect.
                </AlertDescription>
              </Alert>

              <Tabs defaultValue="windows" className="w-full">
                <TabsList className="grid w-full grid-cols-3 mb-6">
                  <TabsTrigger value="windows">Windows</TabsTrigger>
                  <TabsTrigger value="macos">macOS</TabsTrigger>
                  <TabsTrigger value="linux">Linux</TabsTrigger>
                </TabsList>

                <TabsContent value="windows" className="space-y-6">
                  <div className="flex items-center gap-2 mb-4">
                    <Monitor className="h-6 w-6" />
                    <h3 className="text-xl font-semibold">Windows VPN Setup</h3>
                  </div>

                  <Alert className="bg-blue-50 dark:bg-blue-950/40 text-blue-800 dark:text-blue-200 border-blue-200 dark:border-blue-900">
                    <Info className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                    <AlertTitle className="text-blue-900 dark:text-blue-200 font-semibold mb-1">Important for Internal/Cal Poly Students</AlertTitle>
                    <AlertDescription className="text-blue-800 dark:text-blue-200">
                      If you are an Internal or Cal Poly Student, ensure you have completed a request access form via ServiceNow. That form is dedicated for allowing Network Access using Cal Poly SSO.
                      <a href="https://cpp.service-now.com/ehelp?id=sc_cat_item&sys_id=17e10ab82b11e2505379f85ab891bf71" target="_blank" rel="noopener noreferrer" className="underline ml-1 font-medium hover:text-blue-950 dark:hover:text-blue-100">
                        Access the Service Now form.
                      </a>
                    </AlertDescription>
                  </Alert>

                  <StepCard
                    number={1}
                    title="Download GlobalProtect Client"
                    description="Download and install the GlobalProtect VPN client for Windows."
                  >
                    <Button asChild variant="default" className="gap-2">
                      <a href="https://vpn.connect.cpp.edu/global-protect/getmsi.esp?version=64&platform=windows" target="_blank" rel="noopener noreferrer">
                        <Download className="w-4 h-4" />
                        Download GlobalProtect
                      </a>
                    </Button>
                  </StepCard>

                  <StepCard
                    number={2}
                    title="Choose Gateway"
                    description="Open GlobalProtect and enter the gateway address that was emailed to you."
                  >
                    <ul className="list-disc pl-5 space-y-1 text-sm text-muted-foreground">
                      <li>Open GlobalProtect application</li>
                      <li>Enter the Portal/Gateway address from your email</li>
                    </ul>
                  </StepCard>

                  <StepCard
                    number={3}
                    title="Login"
                    description="Depending on your portal, authenticate using one of these methods:"
                  >
                    <ul className="list-disc pl-5 space-y-1 text-sm text-muted-foreground">
                      <li><strong>Credentials:</strong> Use the username and password provided in your email</li>
                      <li><strong>SSO:</strong> Sign on through Single Sign-On if your portal supports it</li>
                    </ul>
                  </StepCard>
                </TabsContent>

                <TabsContent value="macos" className="space-y-6">
                  <div className="flex items-center gap-2 mb-4">
                    <Laptop className="h-6 w-6" />
                    <h3 className="text-xl font-semibold">macOS VPN Setup</h3>
                  </div>

                  <Alert className="bg-blue-50 dark:bg-blue-950/40 text-blue-800 dark:text-blue-200 border-blue-200 dark:border-blue-900">
                    <Info className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                    <AlertTitle className="text-blue-900 dark:text-blue-200 font-semibold mb-1">Important for Internal/Cal Poly Students</AlertTitle>
                    <AlertDescription className="text-blue-800 dark:text-blue-200">
                      Ensure you have completed a request access form via ServiceNow.
                      <a href="https://cpp.service-now.com/ehelp?id=sc_cat_item&sys_id=17e10ab82b11e2505379f85ab891bf71" target="_blank" rel="noopener noreferrer" className="underline ml-1 font-medium hover:text-blue-950 dark:hover:text-blue-100">
                        Request access via Service Now.
                      </a>
                    </AlertDescription>
                  </Alert>

                  <StepCard
                    number={1}
                    title="Download GlobalProtect Client"
                    description="Download the appropriate GlobalProtect client based on your account type:"
                  >
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="border-l-4 border-blue-500 pl-4 py-2 bg-muted/30 rounded-r">
                        <p className="font-semibold text-sm mb-2">Internal/Cal Poly Students</p>
                        <p className="text-xs text-muted-foreground mb-2">
                          Visit the Cal Poly VPN portal:
                        </p>
                        <Button asChild variant="link" className="p-0 h-auto gap-1">
                          <a href="https://vpn.connect.cpp.edu" target="_blank" rel="noopener noreferrer">
                            vpn.connect.cpp.edu <ExternalLink className="w-3 h-3" />
                          </a>
                        </Button>
                      </div>

                      <div className="border-l-4 border-purple-500 pl-4 py-2 bg-muted/30 rounded-r">
                        <p className="font-semibold text-sm mb-2">External Students</p>
                        <p className="text-xs text-muted-foreground mb-2">
                          Download directly:
                        </p>
                        <Button asChild variant="link" className="p-0 h-auto gap-1">
                          <a href="https://vpn.connect.cpp.edu/global-protect/getmsi.esp?version=none&platform=mac" target="_blank" rel="noopener noreferrer">
                            Download for Mac <Download className="w-3 h-3" />
                          </a>
                        </Button>
                      </div>
                    </div>
                    <div className="mt-4 rounded-lg overflow-hidden border shadow-sm">
                      <Image src="/img/instructions/osx/1.png" alt="Download GlobalProtect" width={1280} height={720} sizes="100vw" className="w-full" />
                    </div>
                  </StepCard>

                  <StepCard number={2} title="Open the Installer" description="Locate the downloaded .pkg file and open it.">
                    <Image src="/img/instructions/osx/2.png" alt="Open installer" width={1280} height={720} sizes="(max-width: 1024px) 100vw, 512px" className="rounded-lg border shadow-sm mt-3 w-full max-w-lg mx-auto" />
                  </StepCard>

                  <StepCard number={3} title="Installation Wizard" description="Follow the installation wizard. Click 'Continue' to proceed.">
                    <Image src="/img/instructions/osx/3.png" alt="Wizard" width={1280} height={720} sizes="(max-width: 1024px) 100vw, 512px" className="rounded-lg border shadow-sm mt-3 w-full max-w-lg mx-auto" />
                  </StepCard>

                  <StepCard number={4} title="Select Installation Location" description="Choose destination and click 'Install'.">
                    <Image src="/img/instructions/osx/4.png" alt="Location" width={1280} height={720} sizes="(max-width: 1024px) 100vw, 512px" className="rounded-lg border shadow-sm mt-3 w-full max-w-lg mx-auto" />
                  </StepCard>

                  <StepCard number={5} title="Authenticate Installation" description="Enter your macOS user password.">
                    <Image src="/img/instructions/osx/5.png" alt="Auth" width={1280} height={720} sizes="(max-width: 768px) 100vw, 448px" className="rounded-lg border shadow-sm mt-3 w-full max-w-md mx-auto" />
                  </StepCard>

                  <StepCard number={6} title="Complete Installation" description="Wait for completion, then click 'Close'.">
                    <Image src="/img/instructions/osx/6.png" alt="Complete" width={1280} height={720} sizes="(max-width: 1024px) 100vw, 512px" className="rounded-lg border shadow-sm mt-3 w-full max-w-lg mx-auto" />
                  </StepCard>

                  <StepCard number={7} title="Login to GlobalProtect" description="Authenticate based on your account type.">
                    <div className="space-y-4 mt-4">
                      <div className="border-l-4 border-blue-500 pl-4">
                        <p className="font-semibold text-sm mb-2">Internal (SSO)</p>
                        <Image src="/img/instructions/osx/7a.png" alt="SSO login" width={1280} height={720} sizes="(max-width: 640px) 100vw, 384px" className="rounded-lg border shadow-sm w-full max-w-sm mb-2" />
                        <Image src="/img/instructions/osx/8a.png" alt="SSO auth" width={1280} height={720} sizes="(max-width: 1536px) 100vw, 672px" className="rounded-lg border shadow-sm w-full max-w-2xl" />
                      </div>
                      <div className="border-l-4 border-purple-500 pl-4">
                        <p className="font-semibold text-sm mb-2">External</p>
                        <Image src="/img/instructions/osx/7b.png" alt="External login" width={1280} height={720} sizes="(max-width: 640px) 100vw, 384px" className="rounded-lg border shadow-sm w-full max-w-sm mb-2" />
                        <Image src="/img/instructions/osx/8b.png" alt="External auth" width={1280} height={720} sizes="(max-width: 768px) 100vw, 448px" className="rounded-lg border shadow-sm w-full max-w-md" />
                      </div>
                    </div>
                  </StepCard>

                  <Alert className="bg-green-50 dark:bg-green-950/40 text-green-800 dark:text-green-200 border-green-200 dark:border-green-900 mt-6">
                    <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
                    <AlertTitle className="text-green-800 dark:text-green-200 font-semibold">Connected!</AlertTitle>
                    <AlertDescription>
                      You&apos;re now connected to the VPN.
                      <div className="mt-3 bg-card p-3 rounded border border-green-200 dark:border-green-900">
                        <p className="font-medium text-sm mb-2">Access Services:</p>
                        <div className="space-y-1">
                          <a href="http://proxmox.sdc.cpp" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm hover:underline">
                            <ExternalLink className="w-4 h-4 text-green-600 dark:text-green-400" /> http://proxmox.sdc.cpp
                          </a>
                          <a href="http://kamino.sdc.cpp" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm hover:underline">
                            <ExternalLink className="w-4 h-4 text-green-600 dark:text-green-400" /> http://kamino.sdc.cpp
                          </a>
                        </div>
                      </div>
                    </AlertDescription>
                  </Alert>
                </TabsContent>

                <TabsContent value="linux" className="space-y-6">
                  <div className="flex items-center gap-2 mb-4">
                    <Terminal className="h-6 w-6" />
                    <h3 className="text-xl font-semibold">Linux VPN Setup</h3>
                  </div>

                  <Alert className="bg-blue-50 dark:bg-blue-950/40 text-blue-800 dark:text-blue-200 border-blue-200 dark:border-blue-900">
                    <Info className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                    <AlertTitle className="text-blue-900 dark:text-blue-200 font-semibold mb-1">Important for Internal/Cal Poly Students</AlertTitle>
                    <AlertDescription className="text-blue-800 dark:text-blue-200">
                      Ensure you have completed a request access form via ServiceNow.
                      <a href="https://cpp.service-now.com/ehelp?id=sc_cat_item&sys_id=17e10ab82b11e2505379f85ab891bf71" target="_blank" rel="noopener noreferrer" className="underline ml-1 font-medium hover:text-blue-950 dark:hover:text-blue-100">
                        Request access via Service Now.
                      </a>
                    </AlertDescription>
                  </Alert>

                  <StepCard number={1} title="Install GlobalProtect" description="Download and install GlobalProtect for Linux from Palo Alto Networks:">
                    <Button asChild variant="default" className="gap-2">
                      <a href="https://www.paloaltonetworks.com/network-security/globalprotect" target="_blank" rel="noopener noreferrer">
                        <Download className="w-4 h-4" />
                        Download for Linux
                      </a>
                    </Button>
                  </StepCard>

                  <StepCard number={2} title="Choose Gateway" description="Connect to the gateway via CLI:">
                    <div className="bg-slate-950 text-green-400 p-4 rounded-md font-mono text-sm shadow-inner">
                      globalprotect connect --portal [gateway-address]
                    </div>
                    <p className="text-sm text-muted-foreground mt-2">Replace [gateway-address] with the address from your email.</p>
                  </StepCard>

                  <StepCard number={3} title="Login" description="Authenticate using one of these methods:">
                    <ul className="list-disc pl-5 space-y-1 text-sm text-muted-foreground">
                      <li><strong>Credentials:</strong> Use the username and password provided in your email</li>
                      <li><strong>SSO:</strong> Sign on through Single Sign-On if your portal supports it</li>
                    </ul>
                  </StepCard>
                </TabsContent>
              </Tabs>

              <div className="mt-8 border-t pt-6">
                <h3 className="text-lg font-semibold mb-4">Troubleshooting Tips</h3>
                <Card className="bg-blue-50/50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-900">
                  <CardContent className="pt-6">
                    <h4 className="font-medium text-blue-900 dark:text-blue-200 mb-3 flex items-center gap-2">
                      <AlertCircle className="w-4 h-4" /> Common Connection Issues
                    </h4>
                    <ul className="text-sm text-blue-800 dark:text-blue-200 space-y-2 list-disc pl-5">
                      <li>Verify your username and password are correct</li>
                      <li>Check your internet connection is stable</li>
                      <li>Try disconnecting and reconnecting to the VPN</li>
                      <li>Ensure your firewall isn&apos;t blocking the VPN connection</li>
                      <li>Restart the GlobalProtect application</li>
                      <li>Verify you&apos;re using the correct gateway address from your email</li>
                    </ul>
                  </CardContent>
                </Card>
              </div>

            </CardContent>
          </Card>
        </m.div>

        <div className="text-center pb-8">
          <Button variant="link" asChild>
            <Link href="/" className="text-muted-foreground hover:text-foreground">
              Return to Home
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

function StepCard({ number, title, description, children }: { number: number, title: string, description: string, children?: React.ReactNode }) {
  return (
    <div className="bg-card rounded-lg p-6 border shadow-sm">
      <h4 className="font-medium text-base mb-4 flex items-center gap-3">
        <span className="shrink-0 w-8 h-8 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-sm font-bold shadow-sm">{number}</span>
        {title}
      </h4>
      <p className="text-sm text-muted-foreground ml-11 mb-3">
        {description}
      </p>
      {children && <div className="ml-11">{children}</div>}
    </div>
  )
}

export default function InstructionsClient() {
  return (
    <LazyMotionBoundary>
      <InstructionsPageContent />
    </LazyMotionBoundary>
  );
}
