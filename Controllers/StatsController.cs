using Microsoft.AspNetCore.Mvc;
using System.Diagnostics;
using System.IO;
using System.Text.RegularExpressions;

namespace psyzx.Controllers
{
    [ApiController]
    [Route("api/Tracks/stats")]
    public class StatsController : ControllerBase
    {
        [HttpGet]
        public IActionResult GetStats()
        {
            var process = Process.GetCurrentProcess();
            long appRam = process.WorkingSet64 / (1024 * 1024);
            int threads = process.Threads.Count;

            long sysTotal = 16384;
            long sysUsed = 8192;

            try 
            {
                if (System.IO.File.Exists("/proc/meminfo"))
                {
                    var lines = System.IO.File.ReadAllLines("/proc/meminfo");
                    long memTotal = 0;
                    long memAvailable = 0;
                    
                    foreach (var line in lines)
                    {
                        if (line.StartsWith("MemTotal:"))
                            memTotal = long.Parse(Regex.Match(line, @"\d+").Value) / 1024;
                        if (line.StartsWith("MemAvailable:"))
                            memAvailable = long.Parse(Regex.Match(line, @"\d+").Value) / 1024;
                    }
                    
                    if (memTotal > 0)
                    {
                        sysTotal = memTotal;
                        sysUsed = memTotal - memAvailable;
                    }
                }
            } 
            catch {}

            return Ok(new {
                appRamUsageMb = appRam,
                sysRamUsedMb = sysUsed,
                sysRamTotalMb = sysTotal,
                appThreads = threads
            });
        }
    }
}