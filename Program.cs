using Microsoft.EntityFrameworkCore;
using psyzx.Data;
using psyzx.Services;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authentication.Cookies;
using System.Diagnostics;

var builder = WebApplication.CreateBuilder(args);

builder.Configuration.AddIniFile("config.ini", optional: true, reloadOnChange: true);

var connectionString = builder.Configuration.GetConnectionString("DefaultConnection");

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseMySql(connectionString, ServerVersion.AutoDetect(connectionString)));

builder.Services.AddHttpClient();

builder.Services.AddScoped<LibraryScanner>();
builder.Services.AddSingleton<LyricsDownloader>();

builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(options =>
    {
        options.Events.OnRedirectToLogin = context =>
        {
            context.Response.StatusCode = 401;
            return Task.CompletedTask;
        };
    });

builder.Services.AddAuthorization();

builder.Services.AddControllers().AddJsonOptions(options =>
{
    options.JsonSerializerOptions.ReferenceHandler = ReferenceHandler.IgnoreCycles;
});

builder.Logging.ClearProviders();
// builder.Logging.AddSimpleConsole(options =>
// {
//     options.IncludeScopes = false;
//     options.TimestampFormat = "[HH:mm:ss] ";
//     options.SingleLine = true;
// });

var app = builder.Build();

var currentPath = app.Configuration["MusicSettings:BasePath"] ?? "";
if (!string.IsNullOrWhiteSpace(currentPath))
{
    currentPath = Path.GetFullPath(currentPath);
    var lastPathFile = "last_base_path.txt";
    var lastPath = File.Exists(lastPathFile) ? File.ReadAllText(lastPathFile).Trim() : "";

    if (!string.IsNullOrEmpty(lastPath) && !string.Equals(lastPath, currentPath, StringComparison.OrdinalIgnoreCase))
    {
        Console.WriteLine($"\nWARNING: Directory changed from {lastPath} to {currentPath}");
        Console.Write("Do you want to proceed? (y/n): ");
        
        try 
        {
            var response = Console.ReadLine();
            if (response?.ToLower() != "y")
            {
                Environment.Exit(0);
            }
        }
        catch (InvalidOperationException)
        {
            Console.WriteLine("Non-interactive environment detected. Bypassing prompt.");
        }
    }
    File.WriteAllText(lastPathFile, currentPath);

    if (!Directory.Exists(currentPath))
    {
        Directory.CreateDirectory(currentPath);
    }

    var ytdlpPath = Path.Combine(currentPath, "yt-dlp_linux");
    var spotdlPath = Path.Combine(currentPath, "spotdl_linux");

    using var httpClient = new HttpClient();

    if (!File.Exists(ytdlpPath))
    {
        Console.WriteLine("Downloading yt-dlp_linux...");
        var bytes = await httpClient.GetByteArrayAsync("https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux");
        await File.WriteAllBytesAsync(ytdlpPath, bytes);
    }

    if (!File.Exists(spotdlPath))
    {
        Console.WriteLine("Downloading spotdl_linux...");
        var bytes = await httpClient.GetByteArrayAsync("https://github.com/spotDL/spotify-downloader/releases/latest/download/spotdl-linux");
        await File.WriteAllBytesAsync(spotdlPath, bytes);
    }

    try
    {
        var ytdlpInfo = new FileInfo(ytdlpPath);
        ytdlpInfo.UnixFileMode |= UnixFileMode.UserExecute | UnixFileMode.GroupExecute | UnixFileMode.OtherExecute;
        
        var spotdlInfo = new FileInfo(spotdlPath);
        spotdlInfo.UnixFileMode |= UnixFileMode.UserExecute | UnixFileMode.GroupExecute | UnixFileMode.OtherExecute;
    }
    catch
    {
        try
        {
            Process.Start(new ProcessStartInfo { FileName = "chmod", Arguments = $"+x \"{ytdlpPath}\"", CreateNoWindow = true })?.WaitForExit();
            Process.Start(new ProcessStartInfo { FileName = "chmod", Arguments = $"+x \"{spotdlPath}\"", CreateNoWindow = true })?.WaitForExit();
        }
        catch { }
    }
}

app.UseDefaultFiles();
app.UseStaticFiles();

app.UseAuthentication();
app.UseAuthorization();

app.MapControllers().RequireAuthorization();

app.MapGet("/api/health", () =>
{
    bool ffmpegOk = false;
    try
    {
        var process = Process.Start(new ProcessStartInfo { FileName = "ffmpeg", Arguments = "-version", RedirectStandardOutput = true, UseShellExecute = false });
        process?.WaitForExit();
        ffmpegOk = process?.ExitCode == 0;
    }
    catch { }
    return new { status = "ok", os = "linux", ffmpegInstalled = ffmpegOk };
}).AllowAnonymous();

_ = Task.Run(async () =>
{
    using var scope = app.Services.CreateScope();
    var scanner = scope.ServiceProvider.GetRequiredService<LibraryScanner>();
    await scanner.ScanAsync();
});

app.UseCors(policy => policy
    .AllowAnyOrigin()
    .AllowAnyMethod()
    .AllowAnyHeader()
    .WithExposedHeaders("Content-Range", "Content-Length", "Accept-Ranges"));

app.Run();