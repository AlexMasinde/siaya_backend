import puppeteer from 'puppeteer';
import { AppDataSource } from '../config/database';
import { Event } from '../entities/Event';
import { Participant } from '../entities/Participant';
import { CheckInLog } from '../entities/CheckInLog';
import { User } from '../entities/User';
import logger from '../config/logger';

export class PdfService {
  private static instance: PdfService;

  private constructor() {}

  public static getInstance(): PdfService {
    if (!PdfService.instance) {
      PdfService.instance = new PdfService();
    }
    return PdfService.instance;
  }

  // --- Helper Methods ---

  private async getLogoDataUrl(): Promise<string | null> {
    try {
      const logoUrl = 'https://mobilizers-bulk-uploads.nyc3.digitaloceanspaces.com/cof.png';
      
      const response = await fetch(logoUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });
      if (response.ok) {
        const buffer = await response.arrayBuffer();
        const base64 = Buffer.from(buffer).toString('base64');
        return `data:image/jpeg;base64,${base64}`;
      }
    } catch (error) {
      logger.warn('Could not load logo for PDF', { error });
    }
    return null;
  }

  private calculateAge(dateOfBirth: Date | string | null): number | null {
    if (!dateOfBirth) return null;
    const birthDate = new Date(dateOfBirth);
    if (isNaN(birthDate.getTime())) return null;
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age;
  }

  private getAgeGroup(age: number | null): string {
    if (age === null) return 'NOT STATED';
    if (age < 18) return 'Under 18';
    if (age >= 18 && age < 27) return '18-27';
    if (age >= 27 && age < 35) return '27-35';
    if (age >= 35 && age < 50) return '35-50';
    if (age >= 50 && age < 65) return '50-64';
    if (age >= 65) return '65+';
    return 'NOT STATED';
  }

  private normalizeGender(rawGender: string | null | undefined): string {
    if (!rawGender) return 'NOT STATED';
    const gender = rawGender.trim().toUpperCase();
    if (gender === 'M' || gender === 'MALE') return 'MALE';
    if (gender === 'F' || gender === 'FEMALE') return 'FEMALE';
    return 'NOT STATED';
  }

  // --- Main Report Generation ---

  public async getEventAnalytics(eventId: string): Promise<{ event: Event, stats: any }> {
      const eventRepository = AppDataSource.getRepository(Event);
      const participantRepository = AppDataSource.getRepository(Participant);
      const checkInLogRepository = AppDataSource.getRepository(CheckInLog);

      const event = await eventRepository.findOne({ where: { eventId } });
      if (!event) throw new Error('Event not found');

      const participants = await participantRepository.find({
        where: { eventId },
      });

      const checkIns = await checkInLogRepository.find({
        where: { eventId },
        relations: ['participant'],
      });
      
      const checkedInParticipantIds = new Set(checkIns.map(c => c.participant.id));
      const checkedInParticipants = participants.filter(p => checkedInParticipantIds.has(p.id));

      // 1. Aggregate Data
      const checkedInCount = checkedInParticipants.length;
      
      // Age Stats
      const ageStatsUnsorted = checkedInParticipants.reduce((acc, p) => {
        const age = this.calculateAge(p.dateOfBirth);
        if (age !== null && age < 18) return acc; // Scrap Under 18s
        
        const group = this.getAgeGroup(age);
        acc[group] = (acc[group] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      // Sort Age Stats Ascending
      const ageOrder = ['18-27', '27-35', '35-50', '50-64', '65+', 'NOT STATED'];
      const ageStats: Record<string, number> = {};
      ageOrder.forEach(key => {
          if (ageStatsUnsorted[key]) {
              ageStats[key] = ageStatsUnsorted[key];
          }
      });


      // 2. Top County Representation (Heavily represented county vs Total)
      const countyCounts = checkedInParticipants.reduce((acc, p) => {
          const county = p.county || 'Unknown';
          acc[county] = (acc[county] || 0) + 1;
          return acc;
      }, {} as Record<string, number>);

      let topCounty = 'None';
      let topCountyCount = 0;

      Object.entries(countyCounts).forEach(([county, count]) => {
          if (count > topCountyCount) {
              topCounty = county;
              topCountyCount = count;
          }
      });

      const coverageMetrics = {
          active: topCountyCount, 
          total: checkedInCount,
          rate: checkedInCount > 0 ? Math.round((topCountyCount / checkedInCount) * 100) : 0,
          label: topCounty
      };


      // 3. Voter Registration Status
      const voterStats = participants.reduce((acc, p) => {
        // Only count Checked In participants
        if (!checkedInParticipantIds.has(p.id)) return acc;

        const isRegistered = !!p.constituency?.trim(); // Heuristic: if they have constituency data, they are likely registered
        if (isRegistered) {
          acc.registered.checkedIn++;
        } else {
          acc.nonRegistered.checkedIn++;
        }
        return acc;
      }, {
        registered: { checkedIn: 0 },
        nonRegistered: { checkedIn: 0 }
      });

      // 3b. Attendance Type (Invited vs Walk-in)
      const attendanceTypeStats = checkedInParticipants.reduce((acc, p) => {
          if (p.isInvited) {
              acc.invited++;
          } else {
              acc.walkIn++;
          }
          return acc;
      }, { invited: 0, walkIn: 0 });


      // 4. Constituency & Ward Representation Lists
      // Group by Constituency -> Count
      const constituencyMap = new Map<string, { count: number, county: string }>();
      
      checkedInParticipants.forEach(p => {
          const constName = p.constituency?.trim() || 'NOT STATED';
          const countyName = p.county?.trim() || 'NOT STATED';
          
          if (!constituencyMap.has(constName)) {
              constituencyMap.set(constName, { count: 0, county: countyName });
          }
          constituencyMap.get(constName)!.count++;
      });
      
      const constituenciesRepresented = Array.from(constituencyMap.entries())
        .map(([name, data]) => ({ name, county: data.county, count: data.count }))
        .sort((a, b) => b.count - a.count);

      // Group by Ward -> Count
      const wardMap = new Map<string, { count: number, ward: string, constituency: string, county: string }>();

      checkedInParticipants.forEach(p => {
          const wardName = p.ward?.trim() || 'NOT STATED';
          const constName = p.constituency?.trim() || 'NOT STATED';
          const countyName = p.county?.trim() || 'NOT STATED';

          const key = `${wardName}|${constName}|${countyName}`;
          if (!wardMap.has(key)) {
              wardMap.set(key, { count: 0, ward: wardName, constituency: constName, county: countyName });
          }
          wardMap.get(key)!.count++;
      });

      const wardsRepresented = Array.from(wardMap.values())
        .map(item => ({ 
            name: item.ward, 
            constituency: item.constituency, 
            county: item.county, 
            count: item.count 
        }))
        .sort((a, b) => b.count - a.count);

      // 5. Staff Performance for this Event
      const userRepository = AppDataSource.getRepository(User);
      const users = (await userRepository.find({
          relations: ['checkInLogs']
      })).filter(u => u.role !== 'admin' && u.role !== 'super_admin');

      const eventStaffData = users
          .map(user => {
              const eventCheckIns = user.checkInLogs?.filter(log => log.eventId === eventId).length || 0;
              return {
                  name: user.name,
                  email: user.email,
                  checkIns: eventCheckIns,
                  countiesVisited: eventCheckIns > 0 ? (event.county ? [event.county] : []) : []
              };
          })
          .filter(d => d.checkIns > 0)
          .sort((a, b) => b.checkIns - a.checkIns);


      return {
          event,
          stats: {
            checkedIn: checkedInCount,
            age: ageStats,
            voterStatus: voterStats,
            attendanceType: attendanceTypeStats,
            coverage: coverageMetrics,
            constituencies: constituenciesRepresented,
            wards: wardsRepresented,
            staff: eventStaffData,
            logoUrl: await this.getLogoDataUrl()
          }
      };
  }

  public async getGlobalAnalytics(): Promise<{ stats: any }> {
    const participantRepository = AppDataSource.getRepository(Participant);
    const checkInLogRepository = AppDataSource.getRepository(CheckInLog);

    // 1. Fetch ALL checked-in participants across ALL events
    const checkIns = await checkInLogRepository.find({
        relations: ['participant']
    });

    const checkedInParticipantIds = new Set(checkIns.map(c => c.participant.id));
    
    // Fetch all participants
    const allParticipants = await participantRepository.find();
    
    // 2. Aggregate Data Globally
    const totalUniqueParticipants = allParticipants.length;

    // Demographics with Normalization
    const genderStats = allParticipants.reduce((acc, p) => {
        const gender = this.normalizeGender(p.sex);
        acc[gender] = (acc[gender] || 0) + 1;
        return acc;
    }, {} as Record<string, number>);

    // Age
    const ageStatsUnsorted = allParticipants.reduce((acc, p) => {
        const age = this.calculateAge(p.dateOfBirth);
        if (age !== null && age < 18) return acc;
        const group = this.getAgeGroup(age);
        acc[group] = (acc[group] || 0) + 1;
        return acc;
    }, {} as Record<string, number>);

    const ageOrder = ['18-27', '27-35', '35-50', '50-64', '65+', 'NOT STATED'];
    const ageStats: Record<string, number> = {};
    ageOrder.forEach(key => {
        if (ageStatsUnsorted[key]) {
            ageStats[key] = ageStatsUnsorted[key];
        }
    });

    // 3. County Breakdown - SIMPLIFIED (No PollingCenter Table)
    const countyActivityMap = new Map<string, { 
        participants: number, 
        registered: number, 
        nonRegistered: number,
        activeCenters: Set<string> 
    }>();

    allParticipants.forEach(p => {
        const county = p.county || 'Unregistered'; 
        
        if (!countyActivityMap.has(county)) {
            countyActivityMap.set(county, { 
                participants: 0, 
                registered: 0, 
                nonRegistered: 0,
                activeCenters: new Set() 
            });
        }
        
        const stats = countyActivityMap.get(county)!;
        stats.participants++;
        
        if (p.pollingCenter) {
            const uniqueKey = `${p.pollingCenter}|${p.ward || ''}|${p.constituency || ''}|${p.county || ''}`;
            stats.activeCenters.add(uniqueKey);
        }

        if (!!p.constituency?.trim()) { 
             stats.registered++;
        } else {
             stats.nonRegistered++;
        }
    });

    let globalActiveCentersCount = 0;
    
    const countyData = Array.from(countyActivityMap.entries()).map(([name, stats]) => {
        const totalCenters = 0; // Unknown without PollingCenter table
        const activeCentersCount = stats.activeCenters.size;
        const coverageRate = 0; // Cannot calculate

        if (name !== 'Unregistered') {
             globalActiveCentersCount += activeCentersCount;
        }

        return {
            name,
            totalParticipants: stats.participants,
            registered: stats.registered,
            nonRegistered: stats.nonRegistered,
            totalCenters: totalCenters,
            activeCenters: activeCentersCount, 
            coverageRate: coverageRate 
        };
    }).sort((a, b) => b.totalParticipants - a.totalParticipants);

    const activeCountiesCount = Array.from(countyActivityMap.keys()).filter(c => c !== 'Unregistered').length;
    
    return {
        stats: {
            checkedIn: totalUniqueParticipants,
            coverage: {
                rate: 0,
                active: globalActiveCentersCount,
                total: 0, 
                activeCenters: globalActiveCentersCount,
                totalCenters: 0,
                activeCounties: activeCountiesCount,
                totalCounties: 47 
            },
            gender: genderStats,
            age: ageStats,
            voterStatus: {
                registered: { checkedIn: allParticipants.filter(p => !!p.constituency?.trim()).length },
                nonRegistered: { checkedIn: allParticipants.filter(p => !p.constituency?.trim()).length }
            },
            subjurisdiction: {
                label: 'County',
                data: countyData
            },
            staff: (await this.getStaffAnalytics()).stats.staff,
            logoUrl: await this.getLogoDataUrl()
        }
    };
  }

  public async getStaffAnalytics(): Promise<any> {
    const userRepository = AppDataSource.getRepository(User);
    const users = (await userRepository.find({
        relations: ['checkInLogs', 'checkInLogs.event']
    })).filter(u => u.role !== 'admin' && u.role !== 'super_admin');

    const staffData = users.map(user => {
        const checkInCount = user.checkInLogs?.length || 0;
        const countiesSet = new Set<string>();
        user.checkInLogs?.forEach((log: CheckInLog) => {
            if (log.event?.county) {
                countiesSet.add(log.event.county);
            }
        });

        return {
            name: user.name,
            email: user.email,
            checkIns: checkInCount,
            countiesVisited: Array.from(countiesSet).sort()
        };
    });

    staffData.sort((a, b) => b.checkIns - a.checkIns);

    return {
        stats: {
            staff: staffData,
            totalUsers: users.length,
            totalCheckIns: staffData.reduce((sum, d) => sum + d.checkIns, 0),
            logoUrl: await this.getLogoDataUrl()
        }
    };
  }

  public async generateStaffReport(token?: string): Promise<Buffer> {
      const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3001';
      const reportUrl = `${baseUrl}/reports/staff?token=${token || ''}`;
      logger.info(`Generating Staff Performance Report from: ${reportUrl}`);
      return this.generatePdfFromUrl(reportUrl);
  }

  public async generateGlobalReport(token?: string): Promise<Buffer> {
      const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3001';
      const reportUrl = `${baseUrl}/reports/global?token=${token || ''}`;
      logger.info(`Generating Global Report from: ${reportUrl}`);
      return this.generatePdfFromUrl(reportUrl);
  }

  async generateEventReport(eventId: string, token?: string): Promise<Buffer> {
      const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3001';
      const reportUrl = `${baseUrl}/reports/event/${eventId}?token=${token || ''}`;
      logger.info(`Generating Event Report from: ${reportUrl}`);
      
      return this.generatePdfFromUrl(reportUrl);
  }

  private async generatePdfFromUrl(targetUrl: string): Promise<Buffer> {
    let browser;
    try {
      logger.info(`Navigating to report URL: ${targetUrl}`);

      // Puppeteer Setup (Local vs Remote)
      const isDevelopment = process.env.NODE_ENV !== 'production';
      
      if (isDevelopment) {
          logger.info('Launching Local Puppeteer (Development Mode)...');
          browser = await puppeteer.launch({
              headless: true,
              args: ['--no-sandbox', '--disable-setuid-sandbox'],
              defaultViewport: {
                width: 1400,
                height: 900,
                deviceScaleFactor: 2
            }
          });
      } else {
          logger.info('Connecting to Remote Browserless (Production Mode)...');
          const browserlessUrl = 'wss://production-sfo.browserless.io?token=2TWhMjjwY2OITnpf9f3886140c278370a3319ac18cb3aa3df';
          browser = await puppeteer.connect({ 
             browserWSEndpoint: browserlessUrl,
             defaultViewport: {
                 width: 1400, 
                 height: 900,
                 deviceScaleFactor: 2
             }
           });
      }

      const page = await browser.newPage();
      
      // Attach Debug Loggers
      page.on('console', msg => logger.info(`[Browser Console]: ${msg.text()}`));
      page.on('pageerror', (err: any) => logger.error(`[Browser Error]: ${err.message}`));
      page.on('requestfailed', request => {
        logger.error(`[Browser Network Fail]: ${request.url()} - ${request.failure()?.errorText}`);
      });

      // Navigate
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      
      // Wait for the specific container
      try {
          await page.waitForSelector('#report-page-1', { timeout: 30000 });
      } catch (e) {
          logger.warn('Timed out waiting for #report-page-1, trying to print anyway...');
      }
      
      // Small delay for Chart animations
      await new Promise(r => setTimeout(r, 1000));


      // 5. Generate PDF
      const pdfBuffer = await page.pdf({
        format: 'A4',
        landscape: true,
        printBackground: true,
        margin: {
          top: '0px',
          bottom: '0px',
          left: '0px',
          right: '0px'
        }
      });

      return Buffer.from(pdfBuffer);
    } catch (error) {
      logger.error('Error generating PDF:', error);
      throw error;
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }
}
