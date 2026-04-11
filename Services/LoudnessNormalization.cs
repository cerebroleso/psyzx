// using System.Diagnostics;
// using System.Text.RegularExpressions;
// using Microsoft.Extensions.Hosting;
// using Microsoft.Extensions.DependencyInjection;
// using Microsoft.EntityFrameworkCore;
// using psyzx.Data;
// using psyzx.Models;

// namespace psyzx.Services;

// public class LufsAnalyzerWorker : BackgroundService
// {
//     private readonly IServiceProvider _serviceProvider;
//     private const double TargetLufs = -14.0;

//     public LufsAnalyzerWorker(IServiceProvider serviceProvider)
//     {
//         _serviceProvider = serviceProvider;
//     }

//     protected override async Task ExecuteAsync(CancellationToken stoppingToken)
//     {
//         while (!stoppingToken.IsCancellationRequested)
//         {
//             using var scope = _serviceProvider.CreateScope();
//             var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();

//             var tracksToAnalyze = await dbContext.Tracks
//                 .Where(t => t.LufsOffset == null && t.FilePath != null)
//                 .Take(10)
//                 .ToListAsync(stoppingToken);

//             foreach (var track in tracksToAnalyze)
//             {
//                 double? trackLufs = await AnalyzeLufsAsync(track.FilePath, stoppingToken);

//                 if (trackLufs.HasValue)
//                 {
//                     track.LufsOffset = TargetLufs - trackLufs.Value;
//                 }
//                 else
//                 {
//                     track.LufsOffset = 0;
//                 }

//                 await dbContext.SaveChangesAsync(stoppingToken);
//             }

//             await Task.Delay(TimeSpan.FromMinutes(1), stoppingToken);
//         }
//     }

//     private async Task<double?> AnalyzeLufsAsync(string filePath, CancellationToken cancellationToken)
//     {
//         try
//         {
//             var processInfo = new ProcessStartInfo
//             {
//                 FileName = "ffmpeg",
//                 Arguments = $"-nostats -i \"{filePath}\" -filter_complex ebur128 -f null -",
//                 RedirectStandardError = true,
//                 UseShellExecute = false,
//                 CreateNoWindow = true
//             };

//             using var process = new Process { StartInfo = processInfo };
//             process.Start();

//             string output = await process.StandardError.ReadToEndAsync(cancellationToken);
//             await process.WaitForExitAsync(cancellationToken);

//             var match = Regex.Match(output, @"I:\s+(-?\d+\.\d+)\s+LUFS");
//             if (match.Success && double.TryParse(match.Groups[1].Value, System.Globalization.CultureInfo.InvariantCulture, out double lufs))
//             {
//                 return lufs;
//             }
//         }
//         catch
//         {
//         }

//         return null;
//     }
// }