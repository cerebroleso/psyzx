using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using psyzx.Data;
using psyzx.Models;
using System.Security.Cryptography;
using System.Text;

namespace psyzx.Controllers;

[ApiController]
[Route("api/[controller]")]
[AllowAnonymous]
public class AuthController : ControllerBase
{
    private readonly AppDbContext _db;

    public AuthController(AppDbContext db)
    {
        _db = db;
    }

    private static string HashString(string input)
    {
        using var sha256 = SHA256.Create();
        var bytes = sha256.ComputeHash(Encoding.UTF8.GetBytes(input));
        return Convert.ToBase64String(bytes);
    }

    [HttpPost("register")]
    public async Task<IActionResult> Register([FromForm] string username, [FromForm] string password)
    {
        if (await _db.Users.AnyAsync(u => u.Username == username))
        {
            return Conflict();
        }

        var user = new User 
        { 
            Username = username, 
            PasswordHash = HashString(password),
            Role = await _db.Users.AnyAsync() ? "User" : "Admin"
        };

        _db.Users.Add(user);
        await _db.SaveChangesAsync();

        return Ok();
    }

    [HttpPost("login")]
    public async Task<IActionResult> Login([FromForm] string username, [FromForm] string password)
    {
        var hash = HashString(password);
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Username == username && u.PasswordHash == hash);

        if (user != null)
        {
            var claims = new List<Claim> 
            { 
                new Claim(ClaimTypes.Name, user.Username),
                new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
                new Claim(ClaimTypes.Role, user.Role)
            };
            var identity = new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme);
            await HttpContext.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, new ClaimsPrincipal(identity));
            
            return Ok(new { id = user.Id, username = user.Username, role = user.Role });
        }
        
        return Unauthorized();
    }

    [HttpPost("logout")]
    public async Task<IActionResult> Logout()
    {
        await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        return Ok();
    }

    [HttpGet("check")]
    public async Task<IActionResult> Check()
    {
        if (User.Identity?.IsAuthenticated == true) 
        {
            var userIdStr = User.FindFirstValue(ClaimTypes.NameIdentifier);
            if (int.TryParse(userIdStr, out int userId))
            {
                var user = await _db.Users.FindAsync(userId);
                if (user != null)
                {
                    return Ok(new { id = user.Id, username = user.Username, role = user.Role });
                }
            }
        }
        return Unauthorized();
    }
}