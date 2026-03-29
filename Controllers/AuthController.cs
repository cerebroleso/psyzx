namespace psyzx.Controllers;

using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;

[ApiController]
[Route("api/[controller]")]
[AllowAnonymous]
public class AuthController : ControllerBase
{
    private readonly IConfiguration _config;

    public AuthController(IConfiguration config)
    {
        _config = config;
    }

    [HttpPost("login")]
    public async Task<IActionResult> Login([FromForm] string username, [FromForm] string password)
    {
        var validUser = _config["Auth:Username"] ?? "admin";
        var validPass = _config["Auth:Password"] ?? "admin";

        if (username == validUser && password == validPass)
        {
            var claims = new List<Claim> { new Claim(ClaimTypes.Name, username) };
            var identity = new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme);
            await HttpContext.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, new ClaimsPrincipal(identity));
            return Ok();
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
    public IActionResult Check()
    {
        if (User.Identity?.IsAuthenticated == true) return Ok();
        return Unauthorized();
    }
}